import { randomUUID } from "node:crypto";
import { Queue, Worker, type Job } from "bullmq";
import { Redis as IORedis } from "ioredis";
import { env } from "../config/env.js";
import { supplyGuardGraph } from "./graph.js";

export const AUDIT_QUEUE_NAME = "supplyguard-audit-workflow";

export interface AuditJobData {
  tenantId: string;
  threadId: string;
}

/**
 * BullMQ requires `maxRetriesPerRequest: null` on the underlying ioredis
 * connection so blocking commands used by the worker don't time out.
 */
export const redisConnection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const auditQueue = new Queue<AuditJobData>(AUDIT_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

/** Enqueues a cost-audit workflow run for a tenant and returns its thread id. */
export async function enqueueAuditJob(tenantId: string): Promise<AuditJobData> {
  const threadId = randomUUID();
  await auditQueue.add("run-audit-workflow", { tenantId, threadId });
  return { tenantId, threadId };
}

/**
 * BullMQ worker: runs the LangGraph workflow for each queued job. The graph
 * pauses itself at the `supplies_committer` interrupt gate — the worker's
 * job is considered done once the graph has either interrupted (awaiting
 * human approval) or run to completion.
 */
export function startAuditWorker(): Worker<AuditJobData> {
  const worker = new Worker<AuditJobData>(
    AUDIT_QUEUE_NAME,
    async (job: Job<AuditJobData>) => {
      const { tenantId, threadId } = job.data;
      const config = { configurable: { thread_id: threadId } };

      await supplyGuardGraph.invoke(
        {
          tenant_id: tenantId,
          thread_id: threadId,
          status: "running",
        },
        config,
      );

      const snapshot = await supplyGuardGraph.getState(config);
      return { status: snapshot.values.status, threadId };
    },
    { connection: redisConnection },
  );

  worker.on("failed", (job, error) => {
    console.error(`[audit-worker] job ${job?.id} failed:`, error.message);
  });

  return worker;
}
