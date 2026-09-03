#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { supabaseAdmin } from "../config/supabase.js";
import {
  getBatchesAndFefoAlertsInputSchema,
  getSupplierPriceVarianceInputSchema,
  type FefoAlert,
  type PriceVarianceAlert,
} from "./schemas.js";

/**
 * SupplyGuard-AI — Cost Audit MCP server.
 *
 * Exposes read-only inventory analytics tools over stdio to the
 * `cost_auditor` LangGraph node. Every query is explicitly scoped by
 * `tenant_id`, since this process authenticates to Supabase with the
 * service role key (which bypasses RLS by design).
 */

const server = new McpServer({
  name: "supplyguard-audit-server",
  version: "0.1.0",
});

function daysBetween(from: Date, to: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.ceil((to.getTime() - from.getTime()) / msPerDay);
}

function severityFor(daysUntilExpiration: number): FefoAlert["severity"] {
  if (daysUntilExpiration < 0) return "expired";
  if (daysUntilExpiration <= 7) return "critical";
  return "warning";
}

server.registerTool(
  "get_batches_and_fefo_alerts",
  {
    title: "Get batches and FEFO alerts",
    description:
      "Returns product batches expiring within `days_threshold` days for a tenant, ordered First-Expired-First-Out, each tagged with an expiration severity.",
    inputSchema: getBatchesAndFefoAlertsInputSchema.shape,
  },
  async (rawArgs) => {
    const args = getBatchesAndFefoAlertsInputSchema.parse(rawArgs);
    const today = new Date();
    const cutoff = new Date(today.getTime() + args.days_threshold * 24 * 60 * 60 * 1000);

    const { data, error } = await supabaseAdmin
      .from("product_batches")
      .select(
        "id, product_id, product_name, supplier_id, supplier_name, batch_number, quantity, unit_cost, expiration_date",
      )
      .eq("tenant_id", args.tenant_id)
      .lte("expiration_date", cutoff.toISOString().slice(0, 10))
      .order("expiration_date", { ascending: true });

    if (error) {
      throw new Error(`Failed to load product batches: ${error.message}`);
    }

    const alerts: FefoAlert[] = (data ?? []).map((batch) => {
      const expirationDate = new Date(`${batch.expiration_date}T00:00:00Z`);
      const daysUntilExpiration = daysBetween(today, expirationDate);
      return {
        batch_id: batch.id,
        product_id: batch.product_id,
        product_name: batch.product_name,
        supplier_id: batch.supplier_id,
        supplier_name: batch.supplier_name,
        batch_number: batch.batch_number,
        quantity: Number(batch.quantity),
        unit_cost: Number(batch.unit_cost),
        expiration_date: batch.expiration_date,
        days_until_expiration: daysUntilExpiration,
        severity: severityFor(daysUntilExpiration),
      };
    });

    return {
      content: [{ type: "text", text: JSON.stringify(alerts) }],
    };
  },
);

server.registerTool(
  "get_supplier_price_variance",
  {
    title: "Get supplier price variance",
    description:
      "Compares each product/supplier pair's latest unit cost against its historical average and returns pairs whose variance exceeds `variance_threshold_pct`.",
    inputSchema: getSupplierPriceVarianceInputSchema.shape,
  },
  async (rawArgs) => {
    const args = getSupplierPriceVarianceInputSchema.parse(rawArgs);

    const { data, error } = await supabaseAdmin
      .from("product_batches")
      .select("product_id, product_name, supplier_id, supplier_name, unit_cost, received_at")
      .eq("tenant_id", args.tenant_id)
      .order("received_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to load product batches: ${error.message}`);
    }

    type Group = {
      product_id: string;
      product_name: string;
      supplier_id: string;
      supplier_name: string;
      costsNewestFirst: number[];
    };
    const groups = new Map<string, Group>();

    for (const batch of data ?? []) {
      const key = `${batch.product_id}::${batch.supplier_id}`;
      const existing = groups.get(key);
      if (existing) {
        existing.costsNewestFirst.push(Number(batch.unit_cost));
      } else {
        groups.set(key, {
          product_id: batch.product_id,
          product_name: batch.product_name,
          supplier_id: batch.supplier_id,
          supplier_name: batch.supplier_name,
          costsNewestFirst: [Number(batch.unit_cost)],
        });
      }
    }

    const alerts: PriceVarianceAlert[] = [];
    for (const group of groups.values()) {
      const [latest, ...historical] = group.costsNewestFirst;
      if (latest === undefined || historical.length === 0) continue;

      const avgHistorical = historical.reduce((sum, cost) => sum + cost, 0) / historical.length;
      if (avgHistorical === 0) continue;

      const variancePct = ((latest - avgHistorical) / avgHistorical) * 100;
      if (Math.abs(variancePct) < args.variance_threshold_pct) continue;

      alerts.push({
        product_id: group.product_id,
        product_name: group.product_name,
        supplier_id: group.supplier_id,
        supplier_name: group.supplier_name,
        latest_unit_cost: latest,
        avg_historical_unit_cost: Number(avgHistorical.toFixed(4)),
        variance_pct: Number(variancePct.toFixed(2)),
        sample_size: historical.length,
      });
    }

    alerts.sort((a, b) => Math.abs(b.variance_pct) - Math.abs(a.variance_pct));

    return {
      content: [{ type: "text", text: JSON.stringify(alerts) }],
    };
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error("[audit-server] fatal error:", error);
  process.exit(1);
});
