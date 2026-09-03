import { callTool, getPurchasingClient } from "../mcp/client.js";
import type { PurchaseOrderRecord } from "../mcp/schemas.js";
import type { AgentState, AgentStateUpdate } from "./state.js";
import { logAgentTask } from "./taskLog.js";

/**
 * `supplies_drafter` node: turns the most urgent FEFO alert from the audit
 * step into a draft purchase order via the purchasing MCP server, then sets
 * status to `input-required` so the graph halts at the `interruptBefore`
 * gate on `supplies_committer` until a human approves or rejects it.
 */
export async function draftPurchaseNode(state: AgentState): Promise<AgentStateUpdate> {
  await logAgentTask({
    tenantId: state.tenant_id,
    threadId: state.thread_id,
    agentName: "purchasing_agent",
    nodeName: "supplies_drafter",
    status: "running",
  });

  const mostUrgentAlert = state.fefo_alerts[0];
  if (!mostUrgentAlert) {
    await logAgentTask({
      tenantId: state.tenant_id,
      threadId: state.thread_id,
      agentName: "purchasing_agent",
      nodeName: "supplies_drafter",
      status: "completed",
      output: { skipped: true, reason: "no FEFO alerts to act on" },
    });
    return { status: "completed", purchase_draft: null };
  }

  try {
    const matchingPriceAlert = state.price_variance_alerts.find(
      (alert) => alert.product_id === mostUrgentAlert.product_id && alert.supplier_id === mostUrgentAlert.supplier_id,
    );

    const purchasingClient = await getPurchasingClient();
    const draft = await callTool<PurchaseOrderRecord>(purchasingClient, "draft_purchase_order", {
      tenant_id: state.tenant_id,
      thread_id: state.thread_id,
      product_id: mostUrgentAlert.product_id,
      product_name: mostUrgentAlert.product_name,
      supplier_id: mostUrgentAlert.supplier_id,
      supplier_name: mostUrgentAlert.supplier_name,
      quantity: mostUrgentAlert.quantity,
      unit_cost: matchingPriceAlert?.latest_unit_cost ?? mostUrgentAlert.unit_cost,
      rationale: state.rationale,
      price_variance_pct: matchingPriceAlert?.variance_pct,
    });

    await logAgentTask({
      tenantId: state.tenant_id,
      threadId: state.thread_id,
      agentName: "purchasing_agent",
      nodeName: "supplies_drafter",
      status: "input-required",
      output: draft,
    });

    return { purchase_draft: draft, status: "input-required", human_approved: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logAgentTask({
      tenantId: state.tenant_id,
      threadId: state.thread_id,
      agentName: "purchasing_agent",
      nodeName: "supplies_drafter",
      status: "failed",
      error: message,
    });
    return { status: "failed", error: message };
  }
}

/**
 * `supplies_committer` node: runs only after the human-in-the-loop gate
 * (`interruptBefore: ["supplies_committer"]`) has been cleared by the API
 * setting `human_approved` on the checkpointed state. Commits the purchase
 * when `human_approved === true`, otherwise marks it rejected.
 */
export async function commitPurchaseNode(state: AgentState): Promise<AgentStateUpdate> {
  if (!state.purchase_draft) {
    return { status: "completed" };
  }

  await logAgentTask({
    tenantId: state.tenant_id,
    threadId: state.thread_id,
    agentName: "purchasing_agent",
    nodeName: "supplies_committer",
    status: "running",
    input: { human_approved: state.human_approved },
  });

  const approved = state.human_approved === true;

  try {
    const purchasingClient = await getPurchasingClient();
    const finalOrder = await callTool<PurchaseOrderRecord>(purchasingClient, "commit_purchase_order", {
      tenant_id: state.tenant_id,
      order_id: state.purchase_draft.id,
      approved,
      approved_by: state.approved_by ?? "unknown",
    });

    await logAgentTask({
      tenantId: state.tenant_id,
      threadId: state.thread_id,
      agentName: "purchasing_agent",
      nodeName: "supplies_committer",
      status: approved ? "completed" : "rejected",
      output: finalOrder,
    });

    return { purchase_draft: finalOrder, status: approved ? "committed" : "rejected" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logAgentTask({
      tenantId: state.tenant_id,
      threadId: state.thread_id,
      agentName: "purchasing_agent",
      nodeName: "supplies_committer",
      status: "failed",
      error: message,
    });
    return { status: "failed", error: message };
  }
}
