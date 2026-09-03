import { StateGraph, END, START } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph-checkpoint";
import { costAuditNode } from "../agents/costAuditAgent.js";
import { commitPurchaseNode, draftPurchaseNode } from "../agents/purchasingAgent.js";
import { AgentStateAnnotation } from "../agents/state.js";

/**
 * SupplyGuard-AI orchestration graph:
 *
 *   START -> cost_auditor -> supplies_drafter --(interrupt)--> supplies_committer -> END
 *
 * `interruptBefore: ["supplies_committer"]` pauses execution right after the
 * purchase order draft is created, so the checkpointed state can be updated
 * with a human decision (`human_approved`) via the `/api/purchases/approve`
 * route before the graph is resumed with `graph.invoke(null, config)`.
 */
const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("cost_auditor", costAuditNode)
  .addNode("supplies_drafter", draftPurchaseNode)
  .addNode("supplies_committer", commitPurchaseNode)
  .addEdge(START, "cost_auditor")
  .addEdge("cost_auditor", "supplies_drafter")
  .addEdge("supplies_drafter", "supplies_committer")
  .addEdge("supplies_committer", END);

/**
 * In-memory checkpointer: sufficient for a single long-running server
 * process (API + BullMQ worker share this module instance). Swap for a
 * `@langchain/langgraph-checkpoint-postgres` saver to persist checkpoints
 * across restarts / multiple server instances.
 */
export const checkpointer = new MemorySaver();

export const supplyGuardGraph = workflow.compile({
  checkpointer,
  interruptBefore: ["supplies_committer"],
});
