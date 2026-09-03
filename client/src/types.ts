export interface PurchaseOrder {
  id: string;
  tenant_id: string;
  thread_id: string;
  product_id: string;
  product_name: string;
  supplier_id: string;
  supplier_name: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  status: "draft" | "pending_approval" | "committed" | "rejected";
  rationale: string | null;
  price_variance_pct: number | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
  committed_at: string | null;
}
