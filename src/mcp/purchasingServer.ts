#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { supabaseAdmin } from "../config/supabase.js";
import {
  commitPurchaseOrderInputSchema,
  draftPurchaseOrderInputSchema,
  purchaseOrderRecordSchema,
  type PurchaseOrderRecord,
} from "./schemas.js";

/**
 * SupplyGuard-AI — Purchasing MCP server.
 *
 * Exposes write tools over stdio to the `supplies_drafter` and
 * `supplies_committer` LangGraph nodes. `draft_purchase_order` creates a
 * `pending_approval` order; `commit_purchase_order` is only ever invoked
 * after the graph's `interruptBefore` gate has been cleared by a human
 * decision (see src/workflow/graph.ts).
 */

const server = new McpServer({
  name: "supplyguard-purchasing-server",
  version: "0.1.0",
});

function toRecord(row: Record<string, unknown>): PurchaseOrderRecord {
  return purchaseOrderRecordSchema.parse({
    ...row,
    quantity: Number(row.quantity),
    unit_cost: Number(row.unit_cost),
    total_cost: Number(row.total_cost),
    price_variance_pct: row.price_variance_pct === null ? null : Number(row.price_variance_pct),
  });
}

server.registerTool(
  "draft_purchase_order",
  {
    title: "Draft purchase order",
    description:
      "Creates a purchase order in 'pending_approval' status for a tenant, ready for human-in-the-loop review before it can be committed.",
    inputSchema: draftPurchaseOrderInputSchema.shape,
  },
  async (rawArgs) => {
    const args = draftPurchaseOrderInputSchema.parse(rawArgs);

    const { data, error } = await supabaseAdmin
      .from("purchasing_orders")
      .insert({
        tenant_id: args.tenant_id,
        thread_id: args.thread_id,
        product_id: args.product_id,
        product_name: args.product_name,
        supplier_id: args.supplier_id,
        supplier_name: args.supplier_name,
        quantity: args.quantity,
        unit_cost: args.unit_cost,
        rationale: args.rationale,
        price_variance_pct: args.price_variance_pct ?? null,
        status: "pending_approval",
        created_by_agent: "purchasing_agent",
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to draft purchase order: ${error?.message ?? "unknown error"}`);
    }

    return {
      content: [{ type: "text", text: JSON.stringify(toRecord(data)) }],
    };
  },
);

server.registerTool(
  "commit_purchase_order",
  {
    title: "Commit purchase order",
    description:
      "Finalizes a pending purchase order after human review: sets status to 'committed' when approved, or 'rejected' when declined.",
    inputSchema: commitPurchaseOrderInputSchema.shape,
  },
  async (rawArgs) => {
    const args = commitPurchaseOrderInputSchema.parse(rawArgs);

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("purchasing_orders")
      .select("id, status")
      .eq("tenant_id", args.tenant_id)
      .eq("id", args.order_id)
      .single();

    if (fetchError || !existing) {
      throw new Error(`Purchase order ${args.order_id} not found for tenant ${args.tenant_id}`);
    }
    if (existing.status !== "pending_approval") {
      throw new Error(`Purchase order ${args.order_id} is not pending approval (status: ${existing.status})`);
    }

    const { data, error } = await supabaseAdmin
      .from("purchasing_orders")
      .update({
        status: args.approved ? "committed" : "rejected",
        approved_by: args.approved_by,
        committed_at: args.approved ? new Date().toISOString() : null,
      })
      .eq("tenant_id", args.tenant_id)
      .eq("id", args.order_id)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to commit purchase order: ${error?.message ?? "unknown error"}`);
    }

    return {
      content: [{ type: "text", text: JSON.stringify(toRecord(data)) }],
    };
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error("[purchasing-server] fatal error:", error);
  process.exit(1);
});
