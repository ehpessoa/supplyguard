import { useCallback, useEffect, useState } from "react";
import ApprovalModal from "./components/ApprovalModal";
import type { PurchaseOrder } from "./types";

const TENANT_ID_STORAGE_KEY = "supplyguard.tenantId";

async function fetchPendingOrders(tenantId: string): Promise<PurchaseOrder[]> {
  const response = await fetch(`/api/purchases/pending?tenant_id=${encodeURIComponent(tenantId)}`);
  if (!response.ok) {
    throw new Error(`Failed to load pending purchase orders (${response.status})`);
  }
  const body = (await response.json()) as { orders: PurchaseOrder[] };
  return body.orders;
}

async function submitDecision(params: {
  tenantId: string;
  threadId: string;
  approved: boolean;
  approvedBy: string;
}): Promise<void> {
  const response = await fetch("/api/purchases/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_id: params.tenantId,
      thread_id: params.threadId,
      approved: params.approved,
      approved_by: params.approvedBy,
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to submit approval decision (${response.status})`);
  }
}

export default function App() {
  const [tenantId, setTenantId] = useState(() => localStorage.getItem(TENANT_ID_STORAGE_KEY) ?? "");
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (id: string) => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    try {
      setOrders(await fetchPendingOrders(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(TENANT_ID_STORAGE_KEY, tenantId);
    void refresh(tenantId);
  }, [tenantId, refresh]);

  async function handleDecide(orderId: string, approved: boolean): Promise<void> {
    const order = orders.find((candidate) => candidate.id === orderId);
    if (!order) return;

    await submitDecision({
      tenantId,
      threadId: order.thread_id,
      approved,
      approvedBy: "dashboard-user",
    });
    setSelectedOrder(null);
    await refresh(tenantId);
  }

  async function triggerAudit(): Promise<void> {
    if (!tenantId) return;
    await fetch("/api/audit/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: tenantId }),
    });
    setTimeout(() => void refresh(tenantId), 2_000);
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-4xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">SupplyGuard-AI</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Autonomous cost auditing &amp; purchasing approvals
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={tenantId}
              onChange={(event) => setTenantId(event.target.value)}
              placeholder="tenant_id (UUID)"
              className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <button
              type="button"
              onClick={() => void triggerAudit()}
              disabled={!tenantId}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-700"
            >
              Run Audit
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {!tenantId && (
          <p className="text-sm text-slate-500 dark:text-slate-400">Enter a tenant_id above to load pending purchase approvals.</p>
        )}
        {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
        {isLoading && <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>}

        {!isLoading && tenantId && orders.length === 0 && !error && (
          <p className="text-sm text-slate-500 dark:text-slate-400">No purchase orders awaiting approval.</p>
        )}

        <ul className="space-y-3">
          {orders.map((order) => (
            <li
              key={order.id}
              className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <div>
                <p className="font-medium text-slate-900 dark:text-slate-100">{order.product_name}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {order.supplier_name} · {order.quantity} units · ${order.total_cost.toFixed(2)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(order)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Review
              </button>
            </li>
          ))}
        </ul>
      </main>

      {selectedOrder && (
        <ApprovalModal order={selectedOrder} onClose={() => setSelectedOrder(null)} onDecide={handleDecide} />
      )}
    </div>
  );
}
