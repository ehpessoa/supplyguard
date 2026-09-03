import { supabaseAdmin } from "../config/supabase.js";

export type AgentTaskStatus = "running" | "input-required" | "completed" | "rejected" | "failed";

/** Records one LangGraph node execution into `agent_tasks` for audit/observability. */
export async function logAgentTask(params: {
  tenantId: string;
  threadId: string;
  agentName: string;
  nodeName: string;
  status: AgentTaskStatus;
  input?: unknown;
  output?: unknown;
  error?: string;
}): Promise<void> {
  const { error } = await supabaseAdmin.from("agent_tasks").insert({
    tenant_id: params.tenantId,
    thread_id: params.threadId,
    agent_name: params.agentName,
    node_name: params.nodeName,
    status: params.status,
    input: params.input ?? null,
    output: params.output ?? null,
    error: params.error ?? null,
  });

  if (error) {
    console.error(`[agent_tasks] failed to log ${params.nodeName} for thread ${params.threadId}:`, error.message);
  }
}
