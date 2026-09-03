import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env.js";
import { callTool, getAuditClient } from "../mcp/client.js";
import type { FefoAlert, PriceVarianceAlert } from "../mcp/schemas.js";
import type { AgentState, AgentStateUpdate } from "./state.js";
import { logAgentTask } from "./taskLog.js";

const genAI = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

function buildRationalePrompt(fefoAlerts: FefoAlert[], priceAlerts: PriceVarianceAlert[]): string {
  return [
    "You are a supply chain cost auditor. Analyze the following inventory data and produce a",
    "concise technical rationale (max 5 sentences, plain prose, no markdown) explaining the",
    "single most urgent restocking or purchasing action to take right now, and why.",
    "",
    `FEFO alerts (expiring/expired batches, worst first): ${JSON.stringify(fefoAlerts.slice(0, 10))}`,
    "",
    `Supplier price variance alerts (largest variance first): ${JSON.stringify(priceAlerts.slice(0, 10))}`,
  ].join("\n");
}

async function generateRationale(fefoAlerts: FefoAlert[], priceAlerts: PriceVarianceAlert[]): Promise<string> {
  if (fefoAlerts.length === 0 && priceAlerts.length === 0) {
    return "No FEFO or supplier price variance alerts were found; no purchasing action is required at this time.";
  }

  const response = await genAI.models.generateContent({
    model: env.GEMINI_MODEL,
    contents: buildRationalePrompt(fefoAlerts, priceAlerts),
  });

  return response.text?.trim() || "Gemini returned no rationale text.";
}

/**
 * `cost_auditor` node: pulls FEFO and supplier price-variance analytics via
 * the audit MCP server, then asks Gemini Flash for a technical rationale
 * summarizing the most urgent purchasing action.
 */
export async function costAuditNode(state: AgentState): Promise<AgentStateUpdate> {
  await logAgentTask({
    tenantId: state.tenant_id,
    threadId: state.thread_id,
    agentName: "cost_audit_agent",
    nodeName: "cost_auditor",
    status: "running",
    input: { tenant_id: state.tenant_id },
  });

  try {
    const auditClient = await getAuditClient();
    const [fefoAlerts, priceVarianceAlerts] = await Promise.all([
      callTool<FefoAlert[]>(auditClient, "get_batches_and_fefo_alerts", {
        tenant_id: state.tenant_id,
        days_threshold: 30,
      }),
      callTool<PriceVarianceAlert[]>(auditClient, "get_supplier_price_variance", {
        tenant_id: state.tenant_id,
        variance_threshold_pct: 5,
      }),
    ]);

    const rationale = await generateRationale(fefoAlerts, priceVarianceAlerts);

    await logAgentTask({
      tenantId: state.tenant_id,
      threadId: state.thread_id,
      agentName: "cost_audit_agent",
      nodeName: "cost_auditor",
      status: "completed",
      output: { fefo_alerts: fefoAlerts.length, price_variance_alerts: priceVarianceAlerts.length, rationale },
    });

    return {
      fefo_alerts: fefoAlerts,
      price_variance_alerts: priceVarianceAlerts,
      rationale,
      status: "audited",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logAgentTask({
      tenantId: state.tenant_id,
      threadId: state.thread_id,
      agentName: "cost_audit_agent",
      nodeName: "cost_auditor",
      status: "failed",
      error: message,
    });
    return { status: "failed", error: message };
  }
}
