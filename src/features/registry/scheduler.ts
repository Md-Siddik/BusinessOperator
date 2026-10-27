import "server-only";

/**
 * In-process workers for single-instance deployments (and `npm run dev`):
 *   fast tick (default 30 s): live change feeds (each source's own interval, e.g. 60 s)
 *                             + new-email check of the Zoho inbox (MAILBOX_POLL_MS, default 60 s)
 *                             + durable job queue (contact research, retries)
 *   slow tick (default 5 min): due day/backfill syncs, latest-publication checks,
 *                              research backfill scheduling, follow-up reminders
 *   Companies House stream: one persistent connection when a streaming key is set.
 *
 * Restart behaviour: every position is in MongoDB (checkpoints, job leases), so a
 * restart resumes where it stopped; expired job leases are retried automatically.
 * Multi-instance / serverless: set REGISTRY_SCHEDULER=off and call /api/registry/cron
 * (slow tick) and /api/jobs/cron (fast tick) from an external scheduler.
 */
const FAST_MS = Number(process.env.WORKER_FAST_TICK_MS || 30_000);
const SLOW_MS = Number(process.env.REGISTRY_SCHEDULER_TICK_MS || 5 * 60_000);

type S = { fast?: NodeJS.Timeout; slow?: NodeJS.Timeout; fastRunning: boolean; slowRunning: boolean; lastFastAt?: Date; lastSlowAt?: Date; lastError?: string };
const g = globalThis as unknown as { __etScheduler?: S };

async function ready() {
  const { connectToDatabase, isDatabaseConfigured } = await import("@/lib/db/connect");
  if (!isDatabaseConfigured()) return false;
  await connectToDatabase();
  return true;
}

/** Live feeds + research jobs. Exported for /api/jobs/cron. */
export async function fastTick(log: (m: string) => void = (m) => console.info(`[worker] ${m}`)) {
  const { runLiveFeeds } = await import("./live");
  const feeds = await runLiveFeeds(log);
  await import("@/features/research/engine"); // registers the "research" job handler
  await import("@/features/opportunities/sync"); // registers owner-only opportunity sync / check handlers
  const { processDueJobs } = await import("@/features/jobs/queue");
  const jobs = await processDueJobs({ concurrency: Number(process.env.RESEARCH_CONCURRENCY || 2), budgetMs: Math.max(10_000, FAST_MS - 5_000) });
  if (jobs.processed || jobs.failed) log(`jobs: ${jobs.processed} done, ${jobs.failed} failed`);
  // Owner's Zoho inbox → CLIENT_EMAIL notifications (throttled by MAILBOX_POLL_MS). Isolated from registry work.
  try {
    const { pollMailbox } = await import("@/features/mailbox/service");
    await pollMailbox((m) => log(`mailbox: ${m}`));
  } catch (err) {
    log(`mailbox: check failed — ${err instanceof Error ? err.message : String(err)}`);
  }
  return { feeds, jobs };
}

/** Day syncs, publication checks, backfill, reminders. Exported for /api/registry/cron. */
export async function slowTick(log: (m: string) => void = (m) => console.info(`[scheduler] ${m}`)) {
  const { runMigrations } = await import("@/lib/migrations");
  await runMigrations((m) => log(`migration: ${m}`));
  const { ensureCountries } = await import("@/features/countries/service");
  await ensureCountries();
  const { ensureServicePackages } = await import("@/features/service-fit/service");
  await ensureServicePackages();
  const { runDueSyncs, checkLatestPublications } = await import("./sync");
  const syncs = await runDueSyncs(log);
  for (const r of syncs) log(`${r.country}: ${r.status}${r.imported !== undefined ? ` (${r.imported} new)` : ""}${r.error ? ` — ${r.error}` : ""}`);
  await checkLatestPublications();
  const { scheduleBackfill, scheduleDueRetries } = await import("@/features/research/engine");
  const queued = await scheduleBackfill();
  if (queued) log(`research backfill: ${queued} companies queued`);
  const retries = await scheduleDueRetries();
  if (retries) log(`research retries: ${retries} due companies queued`);
  try {
    // Company Type ages with the company (startup → needs review → established); manual decisions are kept.
    const { reclassifyStale } = await import("@/features/companies/classification");
    const r = await reclassifyStale();
    if (r.changed) log(`company type: ${r.changed} of ${r.total} re-evaluated companies changed type`);
  } catch (err) {
    log(`company type: re-evaluation failed — ${err instanceof Error ? err.message : String(err)}`);
  }
  if (process.env.ESTABLISHED_COLLECTION !== "off") {
    // Established companies from the same official sources (bounded, once a day per country). Isolated from the daily syncs.
    try {
      const { collectEstablished } = await import("./established");
      for (const r of await collectEstablished()) {
        if (r.days.length || r.error) log(`established ${r.country}: ${r.error ? `failed — ${r.error}` : `${r.kept} kept of ${r.fetched} (${r.imported} new) on ${r.days.join(", ")}`}`);
      }
    } catch (err) {
      log(`established: run failed — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const { dispatchDueFollowUpReminders } = await import("@/features/crm/service");
  await dispatchDueFollowUpReminders();
  if (process.env.OPPORTUNITY_SCHEDULER !== "off") {
    // Owner-only Verified Opportunity Intelligence feeds. Isolated: a failure here never blocks registry work.
    try {
      const { opportunityTick } = await import("@/features/opportunities/sync");
      await opportunityTick((m) => log(`opportunities: ${m}`));
    } catch (err) {
      log(`opportunities: tick failed — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const { startCompaniesHouseStream } = await import("./companies-house-stream");
  startCompaniesHouseStream();
  return { syncs, queued };
}

export function schedulerStatus() {
  const s = g.__etScheduler;
  return { running: !!s, lastFastAt: s?.lastFastAt ?? null, lastSlowAt: s?.lastSlowAt ?? null, lastError: s?.lastError ?? null };
}

export function startScheduler() {
  if (g.__etScheduler || process.env.REGISTRY_SCHEDULER === "off") return;
  const s: S = { fastRunning: false, slowRunning: false };
  g.__etScheduler = s;
  const runFast = async () => {
    if (s.fastRunning) return;
    s.fastRunning = true;
    try {
      if (await ready()) await fastTick();
      s.lastFastAt = new Date();
    } catch (err) {
      s.lastError = err instanceof Error ? err.message : String(err);
      console.error("[worker] tick failed:", s.lastError);
    } finally {
      s.fastRunning = false;
    }
  };
  const runSlow = async () => {
    if (s.slowRunning) return;
    s.slowRunning = true;
    try {
      if (await ready()) await slowTick();
      s.lastSlowAt = new Date();
    } catch (err) {
      s.lastError = err instanceof Error ? err.message : String(err);
      console.error("[scheduler] tick failed:", s.lastError);
    } finally {
      s.slowRunning = false;
    }
  };
  s.fast = setInterval(() => void runFast(), FAST_MS);
  s.slow = setInterval(() => void runSlow(), SLOW_MS);
  s.fast.unref?.();
  s.slow.unref?.();
  // First runs shortly after boot so a fresh install fills "today" without waiting.
  setTimeout(() => void runSlow(), 15_000).unref?.();
  setTimeout(() => void runFast(), 45_000).unref?.();
  console.info(`[scheduler] started (live feeds + jobs every ${Math.round(FAST_MS / 1000)} s, syncs every ${Math.round(SLOW_MS / 60_000)} min).`);
}
