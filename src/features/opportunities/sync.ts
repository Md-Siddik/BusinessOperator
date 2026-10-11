import "server-only";
import type { Types } from "mongoose";
import { fetchPublicPage } from "@/features/intelligence/safe-fetch";
import { ProviderHttpError } from "@/features/registry/http";
import { registerJobHandler, enqueueJob } from "@/features/jobs/queue";
import { Opportunity, OpportunityEvent, OpportunityFeed, OpportunitySyncRun, type OpportunityDoc, type OpportunityFeedDoc } from "@/models";
import { CHECK_INTERVAL_MS, derivedFields, freshnessMs, ingestItems, markRemoved, needsPeriodicChecks, recomputeWhere, sourceVerificationFor } from "./ingest";
import { cleanUrl, decodeEntities, hostOf, registrableDomain } from "./normalize";
import { getOpportunityProvider, OPPORTUNITY_PROVIDERS } from "./providers";
import type { FeedLike, OpportunityProvider } from "./providers/types";
import { CHECK_FAILURE_REVIEW_THRESHOLD } from "./verification";

/**
 * Synchronization engine for opportunity feeds. Runs inside the existing scheduler
 * (slow tick) and job queue (manual runs / re-checks). Guarantees:
 *  - a failed run never deletes records or marks them closed
 *  - one run per feed at a time (lease lock), bounded per-run volume
 *  - exponential backoff after failures; rate-limit responses pause the feed
 */
const LOCK_MS = 15 * 60_000;
const RUN_LIMIT = Number(process.env.OPPORTUNITY_RUN_LIMIT || 1500);
const MAX_BACKOFF_MIN = 12 * 60;
const ARCHIVE_AFTER_DAYS = 30;
export const JOB_SYNC = "opportunity-feed-sync";
export const JOB_CHECK = "opportunity-check";

function feedLike(f: OpportunityFeedDoc): FeedLike & { verification?: OpportunityFeedDoc["verification"] } {
  return { _id: f._id, key: f.key, config: (f.config ?? {}) as Record<string, unknown>, settings: (f.settings ?? {}) as Record<string, unknown>, cursor: f.cursor, verification: f.verification };
}

/** Create one PROVIDER feed per national/global provider (disabled until the owner enables it, except open sources). */
export async function ensureProviderFeeds() {
  for (const p of OPPORTUNITY_PROVIDERS) {
    if (p.perEmployer) continue;
    const settings = Object.fromEntries((p.settingFields ?? []).map((s) => [s.key, s.defaultValue]));
    await OpportunityFeed.updateOne(
      { key: p.id },
      {
        $setOnInsert: {
          key: p.id,
          providerId: p.id,
          kind: "PROVIDER",
          label: p.name,
          // Open, real-data-tested sources start enabled; credentialed / agreement-bound ones start disabled.
          enabled: p.access.type === "OPEN" && !p.requiresAgreement && p.evidence === "REAL_DATA_TESTED",
          settings,
          intervalMinutes: p.recommendedIntervalMinutes,
          nextRunAt: new Date(),
        },
      },
      { upsert: true },
    );
  }
}

function backoffMinutes(provider: OpportunityProvider, failures: number) {
  return Math.min(MAX_BACKOFF_MIN, Math.max(5, provider.recommendedIntervalMinutes / 4) * 2 ** Math.max(0, failures - 1));
}

export type RunOutcome = { feed: string; status: "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED"; created?: number; error?: string };

/** Run one feed now (if not locked). */
export async function runFeed(feedId: Types.ObjectId | string, trigger: "SCHEDULED" | "MANUAL" = "SCHEDULED", actorId?: string, log: (m: string) => void = () => undefined): Promise<RunOutcome> {
  const now = new Date();
  const feed = await OpportunityFeed.findOneAndUpdate({ _id: feedId, $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }] }, { $set: { lockedUntil: new Date(now.getTime() + LOCK_MS) } }, { new: true }).lean<OpportunityFeedDoc>();
  if (!feed) return { feed: String(feedId), status: "SKIPPED", error: "Already running" };
  const provider = getOpportunityProvider(feed.providerId);
  const release = (set: Record<string, unknown>) => OpportunityFeed.updateOne({ _id: feed._id }, { $set: { ...set, lockedUntil: null } });
  if (!provider) {
    await release({ "health.lastError": `Unknown provider ${feed.providerId}`, enabled: false });
    return { feed: feed.key, status: "FAILED", error: "Unknown provider" };
  }
  const configured = provider.isConfigured();
  if (!configured.ok) {
    // Honest configuration state — no run is recorded as a success, and nothing is fabricated.
    await release({ "health.lastError": configured.message ?? `Missing ${configured.missing.join(", ")}`, "health.lastErrorAt": now, nextRunAt: new Date(now.getTime() + 60 * 60_000) });
    return { feed: feed.key, status: "SKIPPED", error: configured.message };
  }

  const run = await OpportunitySyncRun.create({ feedId: feed._id, feedKey: feed.key, providerId: provider.id, trigger, status: "RUNNING", startedAt: now, cursorBefore: feed.cursor, triggeredBy: actorId });
  const errors: string[] = [];
  try {
    const fl = feedLike(feed);
    const result = await provider.fetch({ feed: fl, cursor: feed.cursor ?? null, limit: RUN_LIMIT, log: (m) => log(`${feed.key}: ${m}`), signal: AbortSignal.timeout(LOCK_MS - 60_000) });
    const counts = await ingestItems(result.items, { provider, feed: fl, runId: run._id });
    let removed = 0;
    if (result.removedIds?.length) removed += await markRemoved(provider, result.removedIds, `${provider.name} reported the posting as removed / inactive.`, run._id);
    if (result.fullListing && result.complete && provider.capabilities.removalDetection === "LISTING_DIFF") removed += await listingDiff(provider, feed, counts.seenIds, run._id);
    if (provider.capabilities.removalDetection === "EXPLICIT") {
      // The change stream reports every removal; no removal up to now = still listed as of this sync.
      const finished = new Date();
      await Opportunity.updateMany({ feedId: feed._id, sourceState: "LISTED" }, { $set: { lastSeenAt: finished } });
      await recomputeWhere(provider, { feedId: feed._id, sourceState: "LISTED", activity: { $ne: "ACTIVE" } }, finished);
    }
    const status = result.complete ? "SUCCESS" : "PARTIAL";
    const finishedAt = new Date();
    await OpportunitySyncRun.updateOne(
      { _id: run._id },
      { $set: { status, finishedAt, durationMs: finishedAt.getTime() - now.getTime(), cursorAfter: result.cursor ?? undefined, complete: result.complete, fetched: result.items.length, created: counts.created, updated: counts.updated, unchanged: counts.unchanged, outOfScope: result.outOfScope ?? 0, removed, duplicatesLinked: counts.duplicatesLinked, errorLog: errors } },
    );
    const interval = feed.intervalMinutes ?? provider.recommendedIntervalMinutes;
    await release({
      cursor: result.cursor ?? feed.cursor ?? null,
      // A partial run (capped) continues soon; a complete one waits for the normal interval.
      nextRunAt: new Date(finishedAt.getTime() + (result.complete ? interval : 5) * 60_000),
      "health.lastRunAt": finishedAt,
      "health.lastRunStatus": status,
      "health.lastSuccessAt": finishedAt,
      "health.consecutiveFailures": 0,
      "health.lastError": null,
    });
    log(`${feed.key}: ${status} — ${counts.created} new, ${counts.updated} updated, ${removed} removed`);
    return { feed: feed.key, status, created: counts.created };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : String(err);
    const rateLimited = err instanceof ProviderHttpError && err.status === 429;
    const failures = (feed.health?.consecutiveFailures ?? 0) + 1;
    const finishedAt = new Date();
    const wait = rateLimited ? Math.max(60, backoffMinutes(provider, failures)) : backoffMinutes(provider, failures);
    await OpportunitySyncRun.updateOne({ _id: run._id }, { $set: { status: "FAILED", finishedAt, durationMs: finishedAt.getTime() - now.getTime(), rateLimited, errorLog: [...errors, message] } });
    await release({
      nextRunAt: new Date(finishedAt.getTime() + wait * 60_000),
      "health.lastRunAt": finishedAt,
      "health.lastRunStatus": "FAILED",
      "health.lastErrorAt": finishedAt,
      "health.lastError": message,
      "health.consecutiveFailures": failures,
      ...(rateLimited && { "health.rateLimitedUntil": new Date(finishedAt.getTime() + wait * 60_000) }),
    });
    log(`${feed.key}: FAILED — ${message}`);
    return { feed: feed.key, status: "FAILED", error: message };
  }
}

/**
 * Listing diff for full-listing providers (ATS boards, careers pages). A posting absent from
 * TWO consecutive complete listings is checked directly when possible; only a definitive source
 * answer (or a second absence for providers without a status endpoint) marks it removed.
 */
async function listingDiff(provider: OpportunityProvider, feed: OpportunityFeedDoc, seenIds: string[], runId: Types.ObjectId) {
  const missing = await Opportunity.find({ feedId: feed._id, sourceState: "LISTED", externalId: { $nin: seenIds } }).select("_id externalId sourceUrl deadline missingFromListings").lean<OpportunityDoc[]>();
  const toRemove: string[] = [];
  for (const m of missing) {
    const count = (m.missingFromListings ?? 0) + 1;
    if (count < 2) {
      await Opportunity.updateOne({ _id: m._id }, { $set: { missingFromListings: count } });
      continue;
    }
    if (provider.checkActivity) {
      const res = await provider.checkActivity({ externalId: m.externalId, sourceUrl: m.sourceUrl, deadline: m.deadline }, feedLike(feed));
      if (res.status === "REMOVED" || res.status === "CLOSED") toRemove.push(m.externalId);
      else if (res.status === "ACTIVE") await Opportunity.updateOne({ _id: m._id }, { $set: { missingFromListings: 0, lastSeenAt: new Date(), lastCheckedAt: new Date(), lastCheckResult: res.detail } });
      else await Opportunity.updateOne({ _id: m._id }, { $set: { missingFromListings: count, lastCheckedAt: new Date(), lastCheckResult: res.detail } });
    } else toRemove.push(m.externalId);
  }
  return markRemoved(provider, toRemove, provider.checkActivity ? "Absent from two consecutive complete listings and the source's status endpoint reports it removed." : "Absent from two consecutive complete listings of the employer's board.", runId);
}

/** Check one record's activity at its source now. Failures never close a record. */
export async function checkOpportunity(id: Types.ObjectId | string, now = new Date()) {
  const doc = await Opportunity.findById(id).lean<OpportunityDoc>();
  if (!doc) return null;
  const provider = getOpportunityProvider(doc.providerId);
  if (!provider?.checkActivity) {
    await Opportunity.updateOne({ _id: doc._id }, { $set: { lastCheckResult: "This source offers no per-record status check; activity follows listings / deadline." } });
    return { status: "UNKNOWN", detail: "No status check available for this source." };
  }
  const feed = doc.feedId ? await OpportunityFeed.findById(doc.feedId).lean<OpportunityFeedDoc>() : null;
  const res = await provider.checkActivity({ externalId: doc.externalId, sourceUrl: doc.sourceUrl, deadline: doc.deadline }, feed ? feedLike(feed) : { _id: null, key: provider.id, config: {}, settings: {} });
  if (res.status === "REMOVED" || res.status === "CLOSED") {
    await markRemoved(provider, [doc.externalId], res.detail, undefined, now);
    return res;
  }
  const failed = !!res.failed;
  const failures = failed ? (doc.consecutiveCheckFailures ?? 0) + 1 : 0;
  const next = {
    ...doc,
    lastSeenAt: res.status === "ACTIVE" ? now : doc.lastSeenAt,
    consecutiveCheckFailures: failures,
    deadline: res.deadline ?? doc.deadline,
  };
  const derived = derivedFields(next, provider, now);
  const retryMs = failed ? Math.min(CHECK_INTERVAL_MS, 60 * 60_000 * 2 ** (failures - 1)) : CHECK_INTERVAL_MS;
  await Opportunity.updateOne(
    { _id: doc._id },
    {
      $set: { ...derived, lastSeenAt: next.lastSeenAt, lastCheckedAt: now, lastCheckResult: res.detail, consecutiveCheckFailures: failures, nextCheckAt: new Date(now.getTime() + retryMs), ...(res.deadline && { deadline: res.deadline }), lastVerification: { result: failed ? "CHECK_FAILED" : res.status, detail: res.detail, at: now } },
      $push: { evidence: { $each: [{ kind: "STATUS_CHECK", result: res.status === "ACTIVE" ? "PASS" : "INCONCLUSIVE", detail: res.detail, url: doc.sourceUrl, at: now }], $slice: -30 } },
    },
  );
  if (derived.activity !== doc.activity) await OpportunityEvent.create({ opportunityId: doc._id, kind: "ACTIVITY_CHANGED", from: doc.activity, to: derived.activity, detail: res.detail, at: now });
  if (failures === CHECK_FAILURE_REVIEW_THRESHOLD) await OpportunityEvent.create({ opportunityId: doc._id, kind: "CHECK_FAILURES", detail: `${failures} consecutive status checks failed; flagged for review.`, at: now });
  return res;
}

/** Periodic status checks for sources without listings / explicit removals (bounded per tick). */
export async function runDueChecks(budget = 60) {
  let checked = 0;
  for (const p of OPPORTUNITY_PROVIDERS.filter(needsPeriodicChecks)) {
    const due = await Opportunity.find({ providerId: p.id, activity: { $in: ["ACTIVE", "UNKNOWN"] }, sourceState: { $ne: "REMOVED_AT_SOURCE" }, archivedAt: null, nextCheckAt: { $lte: new Date() } })
      .sort({ nextCheckAt: 1 })
      .limit(Math.ceil(budget / 3))
      .select("_id")
      .lean<{ _id: Types.ObjectId }[]>();
    for (const d of due) {
      await checkOpportunity(d._id);
      checked++;
      if (checked >= budget) return checked;
    }
  }
  return checked;
}

/** Expiry, staleness and archival. Never deletes; archived records drop out of default views. */
export async function runMaintenance(now = new Date()) {
  let changed = 0;
  for (const p of OPPORTUNITY_PROVIDERS) {
    // Deadline passed → EXPIRED.
    changed += await recomputeWhere(p, { activity: { $in: ["ACTIVE", "UNKNOWN"] }, deadline: { $lt: now } }, now);
    // No source confirmation within the freshness window → UNKNOWN (never CLOSED).
    changed += await recomputeWhere(p, { activity: "ACTIVE", lastSeenAt: { $lt: new Date(now.getTime() - freshnessMs(p)) } }, now);
  }
  const cutoff = new Date(now.getTime() - ARCHIVE_AFTER_DAYS * 86_400_000);
  const archived = await Opportunity.updateMany(
    { archivedAt: null, activity: { $in: ["CLOSED", "EXPIRED"] }, closedAt: { $lt: cutoff }, saved: { $ne: true }, "notes.0": { $exists: false } },
    { $set: { archivedAt: now, summary: null } },
  );
  return { changed, archived: archived.modifiedCount };
}

/**
 * Employer feeds: confirm the ATS board is linked from the employer's official website.
 * Reads the configured careers page (or homepage), respecting robots.txt.
 */
export async function verifyEmployerFeed(feedId: Types.ObjectId | string) {
  const feed = await OpportunityFeed.findById(feedId).lean<OpportunityFeedDoc>();
  if (!feed || feed.kind !== "EMPLOYER") return null;
  const cfg = (feed.config ?? {}) as { token?: string; employerWebsite?: string; careersUrl?: string; region?: string };
  const now = new Date();
  let verification: { status: "LINKED_FROM_OFFICIAL_DOMAIN" | "LINK_NOT_FOUND" | "FETCH_FAILED" | "SAME_DOMAIN"; detail: string; evidenceUrl?: string };
  if (feed.providerId === "careers-page") {
    verification = { status: "SAME_DOMAIN", detail: `Careers page is on the employer's official domain ${registrableDomain(hostOf(cfg.employerWebsite))}.`, evidenceUrl: cfg.careersUrl };
  } else {
    const patterns: Record<string, RegExp> = {
      greenhouse: new RegExp(`(boards|job-boards)(\\.eu)?\\.greenhouse\\.io/(embed/job_board(/js)?\\?for=)?${cfg.token}\\b|greenhouse\\.io/embed/job_board/js\\?for=${cfg.token}\\b`, "i"),
      lever: new RegExp(`jobs(\\.eu)?\\.lever\\.co/${cfg.token}\\b`, "i"),
      ashby: new RegExp(`jobs\\.ashbyhq\\.com/${cfg.token}\\b|ashby_embed|ashbyhq\\.com/${cfg.token}/embed`, "i"),
    };
    const re = patterns[feed.providerId];
    const pages = [cfg.careersUrl, cfg.employerWebsite].filter((u): u is string => !!u);
    verification = { status: "LINK_NOT_FOUND", detail: `No link to the ${feed.providerId} board “${cfg.token}” was found on ${pages.join(" or ")}.` };
    let readAny = false;
    for (const url of pages) {
      const page = await fetchPublicPage(url, { timeoutMs: 15_000 });
      if ("error" in page) continue;
      readAny = true;
      // The page must still be on the official domain after redirects.
      if (registrableDomain(hostOf(page.url)) !== registrableDomain(hostOf(cfg.employerWebsite))) continue;
      if (re && re.test(decodeEntities(page.html))) {
        verification = { status: "LINKED_FROM_OFFICIAL_DOMAIN", detail: `The ${feed.providerId} board “${cfg.token}” is linked from ${cleanUrl(page.url)}.`, evidenceUrl: cleanUrl(page.url) };
        break;
      }
    }
    if (!readAny) verification = { status: "FETCH_FAILED", detail: `The employer website could not be read (${pages.join(", ")}); verification will be retried.` };
  }
  await OpportunityFeed.updateOne({ _id: feed._id }, { $set: { verification: { ...verification, checkedAt: now } } });
  // Propagate to the feed's records and recompute their trust fields.
  const provider = getOpportunityProvider(feed.providerId);
  if (provider) {
    const records = await Opportunity.find({ feedId: feed._id }).lean<OpportunityDoc[]>();
    for (const r of records) {
      const sv = sourceVerificationFor(r.sourceClass, { ...verification, checkedAt: now });
      const employerIdentity = r.companyLink?.method === "REGISTRATION_NUMBER" || r.companyLink?.method === "OFFICIAL_DOMAIN" || sv.status === "LINKED_FROM_OFFICIAL_DOMAIN" ? "CONFIRMED" : r.organization?.registrationNumber ? "REGISTRATION_NUMBER_PROVIDED" : "NOT_CONFIRMED";
      const next = { ...r, sourceVerification: { ...sv, at: now }, employerIdentity };
      const derived = derivedFields(next, provider, now);
      await Opportunity.updateOne(
        { _id: r._id },
        { $set: { sourceVerification: { ...sv, at: now }, employerIdentity, ...derived }, $push: { evidence: { $each: [{ kind: "SOURCE_PUBLISHER", result: sv.status === "LINKED_FROM_OFFICIAL_DOMAIN" || sv.status === "ON_OFFICIAL_DOMAIN" ? "PASS" : "INCONCLUSIVE", detail: sv.detail, url: sv.url, at: now }], $slice: -30 } } },
      );
    }
  }
  return verification;
}

/** Slow-tick entry point: ensure feeds, run due feeds, checks and maintenance within a time budget. */
export async function opportunityTick(log: (m: string) => void = (m) => console.info(`[opportunities] ${m}`), budgetMs = 4 * 60_000) {
  await ensureProviderFeeds();
  const deadline = Date.now() + budgetMs;
  const due = await OpportunityFeed.find({ enabled: true, nextRunAt: { $lte: new Date() }, $or: [{ lockedUntil: null }, { lockedUntil: { $lt: new Date() } }] })
    .sort({ nextRunAt: 1 })
    .select("_id kind verification")
    .lean<OpportunityFeedDoc[]>();
  const outcomes: RunOutcome[] = [];
  for (const f of due) {
    if (Date.now() > deadline) break;
    if (f.kind === "EMPLOYER" && (!f.verification?.status || f.verification.status === "NOT_CHECKED" || f.verification.status === "FETCH_FAILED")) await verifyEmployerFeed(f._id).catch(() => undefined);
    outcomes.push(await runFeed(f._id, "SCHEDULED", undefined, log));
  }
  const checked = Date.now() < deadline ? await runDueChecks() : 0;
  const maintenance = await runMaintenance();
  if (checked || maintenance.changed || maintenance.archived) log(`checks ${checked}, status changes ${maintenance.changed}, archived ${maintenance.archived}`);
  return { outcomes, checked, maintenance };
}

/* ───────── Job handlers (manual runs go through the durable queue) ───────── */

registerJobHandler(JOB_SYNC, async (payload) => {
  const r = await runFeed(String(payload.feedId), "MANUAL", payload.actorId ? String(payload.actorId) : undefined);
  if (r.status === "FAILED") throw new Error(r.error ?? "Sync failed");
});
registerJobHandler(JOB_CHECK, async (payload) => {
  await checkOpportunity(String(payload.opportunityId));
});

export async function enqueueFeedSync(feedId: string, actorId: string) {
  await enqueueJob(JOB_SYNC, `opp-sync:${feedId}`, { feedId, actorId }, { priority: 5, maxAttempts: 1 });
}
