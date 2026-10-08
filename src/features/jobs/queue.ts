import "server-only";
import { Job, type JobDoc } from "@/models";

/**
 * Durable job queue on MongoDB.
 *  - idempotent enqueue by key (re-enqueue only moves the run time earlier)
 *  - lease-based claiming (lockedUntil) so a crashed worker's jobs are retried
 *  - bounded retries with exponential backoff, then DEAD (dead-letter)
 */
type Handler = (payload: Record<string, unknown>, job: JobDoc) => Promise<void>;
const g = globalThis as unknown as { __etJobHandlers?: Map<string, Handler>; __etJobWorker?: boolean };
const handlers = (g.__etJobHandlers ??= new Map());
const LEASE_MS = 5 * 60_000;

export function registerJobHandler(type: string, handler: Handler) {
  handlers.set(type, handler);
}

export async function enqueueJob(type: string, key: string, payload: Record<string, unknown> = {}, opts: { runAt?: Date; priority?: number; maxAttempts?: number } = {}) {
  const runAt = opts.runAt ?? new Date();
  const existing = await Job.findOne({ key }).lean<JobDoc>();
  if (!existing) {
    try {
      await Job.create({ type, key, payload, runAt, priority: opts.priority ?? 0, maxAttempts: opts.maxAttempts ?? 5 });
    } catch {
      /* concurrent enqueue of the same key — fine (idempotent) */
    }
    return;
  }
  if (existing.status === "RUNNING") return;
  if (existing.status === "DONE" || existing.status === "DEAD") {
    await Job.updateOne({ _id: existing._id }, { $set: { status: "QUEUED", payload, runAt, attempts: 0, lastError: undefined, priority: opts.priority ?? existing.priority } });
    return;
  }
  // QUEUED / FAILED: keep the earliest run time and the highest priority.
  await Job.updateOne(
    { _id: existing._id },
    { $set: { payload, runAt: existing.runAt && existing.runAt < runAt ? existing.runAt : runAt, priority: Math.max(existing.priority ?? 0, opts.priority ?? 0) } },
  );
}

async function claim(types?: string[]) {
  const now = new Date();
  return Job.findOneAndUpdate(
    {
      status: { $in: ["QUEUED", "FAILED"] },
      runAt: { $lte: now },
      ...(types && { type: { $in: types } }),
      $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }],
    },
    { $set: { status: "RUNNING", lockedUntil: new Date(now.getTime() + LEASE_MS) }, $inc: { attempts: 1 } },
    { sort: { priority: -1, runAt: 1 }, new: true },
  ).lean<JobDoc>();
}

/** Re-queue RUNNING jobs whose lease expired (worker crashed / restarted). */
export async function recoverExpiredLeases() {
  await Job.updateMany({ status: "RUNNING", lockedUntil: { $lt: new Date() } }, { $set: { status: "FAILED", lastError: "Lease expired (worker restarted)" } });
}

/** Process due jobs for up to `budgetMs`, `concurrency` at a time. */
export async function processDueJobs(opts: { concurrency?: number; budgetMs?: number; types?: string[] } = {}) {
  const deadline = Date.now() + (opts.budgetMs ?? 45_000);
  let processed = 0;
  let failed = 0;
  await recoverExpiredLeases();
  const worker = async () => {
    while (Date.now() < deadline) {
      const job = await claim(opts.types);
      if (!job) return;
      const handler = handlers.get(job.type);
      try {
        if (!handler) throw new Error(`No handler for job type ${job.type}`);
        await handler((job.payload ?? {}) as Record<string, unknown>, job);
        await Job.updateOne({ _id: job._id }, { $set: { status: "DONE", finishedAt: new Date(), lockedUntil: null, lastError: undefined } });
        processed++;
      } catch (err) {
        failed++;
        const dead = job.attempts >= (job.maxAttempts ?? 5);
        const backoff = Math.min(6 * 3_600_000, 60_000 * 2 ** job.attempts);
        await Job.updateOne(
          { _id: job._id },
          { $set: { status: dead ? "DEAD" : "FAILED", lockedUntil: null, lastError: err instanceof Error ? err.message.slice(0, 500) : String(err), runAt: new Date(Date.now() + backoff), ...(dead && { finishedAt: new Date() }) } },
        );
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 2) }, worker));
  return { processed, failed };
}

export async function queueStats() {
  const rows = await Job.aggregate<{ _id: { type: string; status: string }; n: number }>([{ $group: { _id: { type: "$type", status: "$status" }, n: { $sum: 1 } } }]);
  return rows.map((r) => ({ type: r._id.type, status: r._id.status, count: r.n }));
}
