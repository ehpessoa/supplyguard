import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import cron from "node-cron";
import { z } from "zod";
import { env } from "./config/env.js";
import { supabaseAdmin } from "./config/supabase.js";
import { supplyGuardGraph } from "./workflow/graph.js";
import { auditQueue, enqueueAuditJob, startAuditWorker } from "./workflow/queue.js";

const app = express();
app.use(cors({ origin: env.CORS_ORIGIN.split(",").map((origin) => origin.trim()) }));
app.use(express.json());

function asyncHandler(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const triggerAuditSchema = z.object({
  tenant_id: z.string().uuid(),
});

app.post(
  "/api/audit/trigger",
  asyncHandler(async (req, res) => {
    const { tenant_id } = triggerAuditSchema.parse(req.body);
    const job = await enqueueAuditJob(tenant_id);
    res.status(202).json({ message: "Audit workflow enqueued", ...job });
  }),
);

const approvePurchaseSchema = z.object({
  tenant_id: z.string().uuid(),
  thread_id: z.string().min(1),
  approved: z.boolean(),
  approved_by: z.string().min(1),
});

app.post(
  "/api/purchases/approve",
  asyncHandler(async (req, res) => {
    const { tenant_id, thread_id, approved, approved_by } = approvePurchaseSchema.parse(req.body);
    const config = { configurable: { thread_id } };

    const snapshot = await supplyGuardGraph.getState(config);
    if (!snapshot.values || snapshot.values.tenant_id !== tenant_id) {
      res.status(404).json({ error: `No workflow thread ${thread_id} found for tenant ${tenant_id}` });
      return;
    }

    await supplyGuardGraph.updateState(config, { human_approved: approved, approved_by });
    const result = await supplyGuardGraph.invoke(null, config);

    res.json({
      thread_id,
      status: result.status,
      purchase_order: result.purchase_draft,
    });
  }),
);

const pendingPurchasesSchema = z.object({
  tenant_id: z.string().uuid(),
});

app.get(
  "/api/purchases/pending",
  asyncHandler(async (req, res) => {
    const { tenant_id } = pendingPurchasesSchema.parse(req.query);
    const { data, error } = await supabaseAdmin
      .from("purchasing_orders")
      .select("*")
      .eq("tenant_id", tenant_id)
      .eq("status", "pending_approval")
      .order("created_at", { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ orders: data ?? [] });
  }),
);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "Invalid request", issues: error.issues });
    return;
  }
  const message = error instanceof Error ? error.message : "Internal server error";
  console.error("[server] unhandled error:", error);
  res.status(500).json({ error: message });
});

function scheduleDailyAudit(): void {
  if (env.AUDIT_TENANT_IDS.length === 0) {
    console.warn("[cron] AUDIT_TENANT_IDS is empty — skipping daily audit schedule.");
    return;
  }

  cron.schedule(env.AUDIT_CRON_SCHEDULE, () => {
    console.log(`[cron] running scheduled cost audit for ${env.AUDIT_TENANT_IDS.length} tenant(s)`);
    for (const tenantId of env.AUDIT_TENANT_IDS) {
      enqueueAuditJob(tenantId).catch((error: unknown) => {
        console.error(`[cron] failed to enqueue audit for tenant ${tenantId}:`, error);
      });
    }
  });

  console.log(`[cron] daily audit job scheduled: "${env.AUDIT_CRON_SCHEDULE}"`);
}

const worker = startAuditWorker();

const server = app.listen(env.PORT, () => {
  console.log(`[server] SupplyGuard-AI listening on port ${env.PORT}`);
  scheduleDailyAudit();
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[server] received ${signal}, shutting down...`);
  server.close();
  await worker.close();
  await auditQueue.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
