import { useState } from "react";
import type { PurchaseOrder } from "../types";

interface ApprovalModalProps {
  order: PurchaseOrder;
  onClose: () => void;
  onDecide: (orderId: string, approved: boolean) => Promise<void>;
}

/**
 * Human-in-the-loop approval modal shown when a purchase order is
 * `pending_approval`. Approving/rejecting posts back to
 * `/api/purchases/approve`, which resumes the LangGraph workflow at its
 * `supplies_committer` interrupt gate.
 */
export default function ApprovalModal({ order, onClose, onDecide }: ApprovalModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const variance = order.price_variance_pct;
  const isPriceIncrease = variance !== null && variance > 0;

  async function handleDecision(approved: boolean): Promise<void> {
    setIsSubmitting(true);
    try {
      await onDecide(order.id, approved);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-modal-title"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4">
          <h2 id="approval-modal-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Purchase Order Approval
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <dl className="mt-4 grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
          <dt className="col-span-1 text-slate-500 dark:text-slate-400">Product</dt>
          <dd className="col-span-2 font-medium text-slate-900 dark:text-slate-100">{order.product_name}</dd>

          <dt className="col-span-1 text-slate-500 dark:text-slate-400">Supplier</dt>
          <dd className="col-span-2 font-medium text-slate-900 dark:text-slate-100">{order.supplier_name}</dd>

          <dt className="col-span-1 text-slate-500 dark:text-slate-400">Quantity</dt>
          <dd className="col-span-2 text-slate-900 dark:text-slate-100">{order.quantity}</dd>

          <dt className="col-span-1 text-slate-500 dark:text-slate-400">Unit cost</dt>
          <dd className="col-span-2 text-slate-900 dark:text-slate-100">${order.unit_cost.toFixed(2)}</dd>

          <dt className="col-span-1 text-slate-500 dark:text-slate-400">Total</dt>
          <dd className="col-span-2 font-semibold text-slate-900 dark:text-slate-100">
            ${order.total_cost.toFixed(2)}
          </dd>

          {variance !== null && (
            <>
              <dt className="col-span-1 text-slate-500 dark:text-slate-400">Price variance</dt>
              <dd
                className={`col-span-2 font-semibold ${
                  isPriceIncrease ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
                }`}
              >
                {isPriceIncrease ? "+" : ""}
                {variance.toFixed(2)}%
              </dd>
            </>
          )}
        </dl>

        {order.rationale && (
          <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {order.rationale}
          </p>
        )}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => void handleDecision(false)}
            className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
          >
            Rejeitar
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => void handleDecision(true)}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Aprovar Compra
          </button>
        </div>
      </div>
    </div>
  );
}
