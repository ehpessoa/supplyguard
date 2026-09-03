import { z } from "zod";

/** Shared Zod contracts for every MCP tool exposed by the audit and purchasing servers. */

export const tenantScopedSchema = z.object({
  tenant_id: z.string().uuid("tenant_id must be a UUID"),
});

export const getBatchesAndFefoAlertsInputSchema = tenantScopedSchema.extend({
  days_threshold: z.number().int().positive().max(365).default(30),
});
export type GetBatchesAndFefoAlertsInput = z.infer<typeof getBatchesAndFefoAlertsInputSchema>;

export const fefoAlertSchema = z.object({
  batch_id: z.string().uuid(),
  product_id: z.string().uuid(),
  product_name: z.string(),
  supplier_id: z.string().uuid(),
  supplier_name: z.string(),
  batch_number: z.string(),
  quantity: z.number(),
  unit_cost: z.number(),
  expiration_date: z.string(),
  days_until_expiration: z.number(),
  severity: z.enum(["expired", "critical", "warning"]),
});
export type FefoAlert = z.infer<typeof fefoAlertSchema>;

export const getSupplierPriceVarianceInputSchema = tenantScopedSchema.extend({
  variance_threshold_pct: z.number().nonnegative().max(1000).default(5),
});
export type GetSupplierPriceVarianceInput = z.infer<typeof getSupplierPriceVarianceInputSchema>;

export const priceVarianceAlertSchema = z.object({
  product_id: z.string().uuid(),
  product_name: z.string(),
  supplier_id: z.string().uuid(),
  supplier_name: z.string(),
  latest_unit_cost: z.number(),
  avg_historical_unit_cost: z.number(),
  variance_pct: z.number(),
  sample_size: z.number().int(),
});
export type PriceVarianceAlert = z.infer<typeof priceVarianceAlertSchema>;

export const draftPurchaseOrderInputSchema = tenantScopedSchema.extend({
  thread_id: z.string().min(1),
  product_id: z.string().uuid(),
  product_name: z.string().min(1),
  supplier_id: z.string().uuid(),
  supplier_name: z.string().min(1),
  quantity: z.number().positive(),
  unit_cost: z.number().nonnegative(),
  rationale: z.string().min(1),
  price_variance_pct: z.number().optional(),
});
export type DraftPurchaseOrderInput = z.infer<typeof draftPurchaseOrderInputSchema>;

export const purchaseOrderRecordSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  thread_id: z.string(),
  product_id: z.string().uuid(),
  product_name: z.string(),
  supplier_id: z.string().uuid(),
  supplier_name: z.string(),
  quantity: z.number(),
  unit_cost: z.number(),
  total_cost: z.number(),
  status: z.enum(["draft", "pending_approval", "committed", "rejected"]),
  rationale: z.string().nullable(),
  price_variance_pct: z.number().nullable(),
  approved_by: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  committed_at: z.string().nullable(),
});
export type PurchaseOrderRecord = z.infer<typeof purchaseOrderRecordSchema>;

export const commitPurchaseOrderInputSchema = tenantScopedSchema.extend({
  order_id: z.string().uuid(),
  approved: z.boolean(),
  approved_by: z.string().min(1),
});
export type CommitPurchaseOrderInput = z.infer<typeof commitPurchaseOrderInputSchema>;
