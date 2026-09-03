import { Annotation } from "@langchain/langgraph";
import type { FefoAlert, PriceVarianceAlert, PurchaseOrderRecord } from "../mcp/schemas.js";

/**
 * Shared state threaded through every node of the SupplyGuard-AI graph.
 * `tenant_id` and `thread_id` scope the run to a single tenant and a single
 * resumable LangGraph checkpoint/thread respectively.
 */
export const AgentStateAnnotation = Annotation.Root({
  tenant_id: Annotation<string>,
  thread_id: Annotation<string>,

  fefo_alerts: Annotation<FefoAlert[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  price_variance_alerts: Annotation<PriceVarianceAlert[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  rationale: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => "",
  }),

  purchase_draft: Annotation<PurchaseOrderRecord | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),

  /** Set by the API layer (via graph.updateState) once a human has reviewed the draft. */
  human_approved: Annotation<boolean | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  approved_by: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),

  status: Annotation<
    "running" | "audited" | "input-required" | "committed" | "rejected" | "completed" | "failed"
  >({
    reducer: (_left, right) => right,
    default: () => "running",
  }),
  error: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
});

export type AgentState = typeof AgentStateAnnotation.State;
export type AgentStateUpdate = typeof AgentStateAnnotation.Update;
