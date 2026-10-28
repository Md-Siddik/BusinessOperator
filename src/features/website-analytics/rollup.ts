import "server-only";
import { ContactRequest, WebAnalyticsDaily, WebConversion, WebPageView, WebSession, type WebAnalyticsDailyDoc } from "@/models";
import { addDays, localRangeUtc, todayIn, type Day } from "@/lib/dates/country-time";
import { getSetting } from "@/features/settings/service";
import { ANALYTICS_TIME_ZONE } from "./classify";

/**
 * Durable daily statistics (WebAnalyticsDaily, no TTL).
 *
 * Raw page views, sessions and visitors expire after the retention period (TTL). Before they do,
 * each Norwegian calendar day is rolled up into one anonymous row. Rules:
 *  - Today and yesterday are recomputed on every run (late events, open sessions).
 *  - From the day before yesterday on, a day is "final": computed once more and then frozen. A
 *    frozen day is never recomputed, so expired raw data can never lower a historical number.
 *  - Nothing is estimated or invented: a day is computed only from records that exist. A day whose
 *    raw records may have started expiring before its first roll-up is marked `partial`.
 *  - Lead submissions come from the enquiries themselves (ContactRequest, the full history) and
 *    from recorded conversions (client sign-ups from 2026-10 on).
 */

const OPEN_DAYS = 2;
const MAX_BACKFILL_DAYS = 800;

type Row = { key: string; visitors: number; sessions: number; pageViews: number; conversions: number };

async function computeDay(day: Day) {
  const { start, end } = localRangeUtc(day, day, ANALYTICS_TIME_ZONE);
  const sessMatch = { startedAt: { $gte: start, $lt: end } };
  const [sess] = await WebSession.aggregate<{ sessions: number; visitors: unknown[]; returning: unknown[]; duration: number; converted: number }>([
    { $match: sessMatch },
    {
      $group: {
        _id: null,
        sessions: { $sum: 1 },
        visitors: { $addToSet: "$visitorId" },
        returning: { $addToSet: { $cond: [{ $gt: ["$sessionNo", 1] }, "$visitorId", "$$REMOVE"] } },
        duration: { $avg: { $subtract: ["$lastSeen", "$startedAt"] } },
        converted: { $sum: { $cond: [{ $gt: ["$enquiries", 0] }, 1, 0] } },
      },
    },
  ]);
  const [pv] = await WebPageView.aggregate<{ pageViews: number; cookieless: number }>([
    { $match: { at: { $gte: start, $lt: end } } },
    { $group: { _id: null, pageViews: { $sum: 1 }, cookieless: { $sum: { $cond: [{ $and: [{ $eq: ["$consented", false] }, "$entry"] }, 1, 0] } } } },
  ]);
  const by = (field: string, limit: number) =>
    WebSession.aggregate<{ _id: string | null; visitors: unknown[]; sessions: number; pageViews: number; conversions: number }>([
      { $match: sessMatch },
      { $group: { _id: `$${field}`, visitors: { $addToSet: "$visitorId" }, sessions: { $sum: 1 }, pageViews: { $sum: "$pageViews" }, conversions: { $sum: { $cond: [{ $gt: ["$enquiries", 0] }, 1, 0] } } } },
      { $sort: { sessions: -1 } },
      { $limit: limit },
    ]);
  const [sources, devices, countries, pages, enquiries, signups] = await Promise.all([
    by("channel", 20),
    by("device", 5),
    by("geo.country", 30),
    WebPageView.aggregate<{ _id: string; views: number; visitors: unknown[] }>([
      { $match: { at: { $gte: start, $lt: end } } },
      { $group: { _id: "$page", views: { $sum: 1 }, visitors: { $addToSet: "$visitorId" } } },
      { $sort: { views: -1 } },
      { $limit: 50 },
    ]),
    ContactRequest.aggregate<{ _id: string | null; n: number }>([
      { $match: { createdAt: { $gte: start, $lt: end }, isDemo: { $ne: true } } },
      { $group: { _id: "$preferredContact", n: { $sum: 1 } } },
    ]),
    WebConversion.countDocuments({ day, type: "client_signup" }),
  ]);
  const toRows = (rows: { _id: string | null; visitors: unknown[]; sessions: number; pageViews: number; conversions: number }[]): Row[] =>
    rows.map((r) => ({ key: r._id ?? "unknown", visitors: r.visitors.filter(Boolean).length, sessions: r.sessions, pageViews: r.pageViews, conversions: r.conversions }));
  const consultations = enquiries.filter((e) => e._id === "phone" || e._id === "video").reduce((n, e) => n + e.n, 0);
  const contactForms = enquiries.reduce((n, e) => n + e.n, 0) - consultations;
  const unique = sess?.visitors.length ?? 0;
  const returning = sess?.returning.length ?? 0;
  return {
    uniqueVisitors: unique,
    newVisitors: unique - returning,
    returningVisitors: returning,
    sessions: sess?.sessions ?? 0,
    pageViews: pv?.pageViews ?? 0,
    cookielessVisits: pv?.cookieless ?? 0,
    avgSessionSeconds: Math.round((sess?.duration ?? 0) / 1000),
    leads: contactForms + consultations + signups,
    contactForms,
    consultationRequests: consultations,
    clientSignups: signups,
    convertedSessions: sess?.converted ?? 0,
    sources: toRows(sources),
    devices: toRows(devices),
    countries: toRows(countries),
    pages: pages.map((p) => ({ key: p._id, visitors: p.visitors.filter(Boolean).length, sessions: 0, pageViews: p.views, conversions: 0 })),
  };
}

/** Roll up one day (no-op for a frozen day). Returns what was stored, or null when it was frozen. */
export async function rollupDay(day: Day, now = new Date()): Promise<WebAnalyticsDailyDoc | null> {
  const existing = await WebAnalyticsDaily.findOne({ day }).select("final partial").lean<{ final?: boolean; partial?: boolean }>();
  if (existing?.final) return null;
  const today = todayIn(ANALYTICS_TIME_ZONE, now);
  const { retentionDays } = await getSetting("analytics");
  const final = day <= addDays(today, -OPEN_DAYS);
  // The oldest raw records may have expired before this day was first rolled up.
  const partial = existing?.partial ?? (!existing && day <= addDays(today, -(retentionDays - 1)));
  const stats = await computeDay(day);
  return WebAnalyticsDaily.findOneAndUpdate(
    { day, final: { $ne: true } },
    { $set: { ...stats, timeZone: ANALYTICS_TIME_ZONE, final, partial, computedAt: now } },
    { upsert: true, new: true },
  )
    .lean<WebAnalyticsDailyDoc>()
    .catch((e: { code?: number }) => {
      // A concurrent run froze the day first.
      if (e.code === 11000) return null;
      throw e;
    });
}

/**
 * Roll up every day that is not frozen yet: today, yesterday, and (on the first run) every day
 * that still has raw records — the backfill. Idempotent; safe to run as often as wanted.
 */
export async function rollupPending(now = new Date()) {
  const today = todayIn(ANALYTICS_TIME_ZONE, now);
  const [oldestPv, oldestSession, oldestEnquiry, lastFinal] = await Promise.all([
    WebPageView.findOne().sort({ at: 1 }).select("at").lean<{ at: Date }>(),
    WebSession.findOne().sort({ startedAt: 1 }).select("startedAt").lean<{ startedAt: Date }>(),
    ContactRequest.findOne({ isDemo: { $ne: true } }).sort({ createdAt: 1 }).select("createdAt").lean<{ createdAt: Date }>(),
    WebAnalyticsDaily.findOne({ final: true }).sort({ day: -1 }).select("day").lean<{ day: string }>(),
  ]);
  const candidates = [oldestPv?.at, oldestSession?.startedAt, oldestEnquiry?.createdAt].filter((d): d is Date => !!d).map((d) => todayIn(ANALYTICS_TIME_ZONE, d));
  let from = candidates.length ? candidates.sort()[0]! : today;
  if (lastFinal && lastFinal.day >= from) from = addDays(lastFinal.day, 1);
  if (from < addDays(today, -MAX_BACKFILL_DAYS)) from = addDays(today, -MAX_BACKFILL_DAYS);
  if (from > addDays(today, -1)) from = addDays(today, -1);
  let computed = 0;
  for (let d = from; d <= today; d = addDays(d, 1)) if (await rollupDay(d, now)) computed++;
  return { from, to: today, computed };
}

/** Roll up when the last run is older than `maxAgeMs` (used when the Owner opens History / Leads). */
export async function rollupIfStale(maxAgeMs = 10 * 60_000, now = new Date()) {
  const last = await lastRollupAt();
  if (last && now.getTime() - last.getTime() <= maxAgeMs) return null;
  return rollupPending(now);
}

/** The most recent roll-up time (for "updated … ago" on the dashboard). */
export async function lastRollupAt() {
  const doc = await WebAnalyticsDaily.findOne().sort({ computedAt: -1 }).select("computedAt").lean<{ computedAt: Date }>();
  return doc?.computedAt ?? null;
}
