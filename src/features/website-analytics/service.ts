import { Types, type PipelineStage } from "mongoose";
import { ContactRequest, Service, User, WebPageView, WebSession, WebVisitor, type WebSessionDoc, type WebVisitorDoc } from "@/models";
import { Errors } from "@/lib/errors";
import { isOwner, type Actor } from "@/lib/permissions";
import { localRangeUtc, resolveDayRange, type DayRange } from "@/lib/dates/country-time";
import { csvCell } from "@/features/companies/registrations";
import { CHANNEL_LABELS, CHANNELS, type Channel } from "./classify";

/**
 * Website analytics — OWNER ONLY. Every exported function checks the role itself (pages and
 * API routes check it too). Reads only aggregated behaviour; no IP addresses are stored at all.
 */

export const ANALYTICS_TIME_ZONE = "Europe/Oslo";
export const ANALYTICS_PRESETS = ["today", "yesterday", "7d", "30d", "month", "custom"] as const;

function requireOwner(actor: Actor | null | undefined) {
  if (!isOwner(actor)) throw Errors.forbidden();
}

export type AnalyticsRange = DayRange & { start: Date; end: Date };

/** Day range in Norwegian time (default: last 7 days). */
export function analyticsRange(params: { range?: string; from?: string; to?: string }, now = new Date()): AnalyticsRange {
  const preset = (ANALYTICS_PRESETS as readonly string[]).includes(params.range ?? "") ? params.range : "7d";
  const r = resolveDayRange(ANALYTICS_TIME_ZONE, preset, params.from, params.to, now);
  const { start, end } = localRangeUtc(r.from!, r.to!, ANALYTICS_TIME_ZONE);
  return { ...r, start, end };
}

const inRange = (field: string, r: AnalyticsRange) => ({ [field]: { $gte: r.start, $lt: r.end } });
const channelLabel = (c: string | null | undefined) => CHANNEL_LABELS[(c ?? "direct") as Channel] ?? c ?? "Direct / unknown";

/* ───────────── Overview ───────────── */

export type Overview = {
  visits: number;
  cookielessVisits: number;
  uniqueVisitors: number;
  newVisitors: number;
  returningVisitors: number;
  sessions: number;
  pageViews: number;
  avgSessionSeconds: number;
  enquiries: number;
  linkedEnquiries: number;
  daily: { day: string; visits: number; pageViews: number }[];
};

export async function getOverview(actor: Actor, r: AnalyticsRange): Promise<Overview> {
  requireOwner(actor);
  const [sess] = await WebSession.aggregate<{ sessions: number; visitors: Types.ObjectId[]; returning: Types.ObjectId[]; duration: number; enquiries: number }>([
    { $match: inRange("startedAt", r) },
    {
      $group: {
        _id: null,
        sessions: { $sum: 1 },
        visitors: { $addToSet: "$visitorId" },
        returning: { $addToSet: { $cond: [{ $gt: ["$sessionNo", 1] }, "$visitorId", "$$REMOVE"] } },
        duration: { $avg: { $subtract: ["$lastSeen", "$startedAt"] } },
        enquiries: { $sum: "$enquiries" },
      },
    },
  ]);
  const [pv] = await WebPageView.aggregate<{ pageViews: number; cookieless: number }>([
    { $match: inRange("at", r) },
    { $group: { _id: null, pageViews: { $sum: 1 }, cookieless: { $sum: { $cond: [{ $and: [{ $eq: ["$consented", false] }, "$entry"] }, 1, 0] } } } },
  ]);
  const enquiries = await ContactRequest.countDocuments({ ...inRange("createdAt", r), isDemo: { $ne: true } });

  const day = (field: string) => ({ $dateToString: { format: "%Y-%m-%d", date: `$${field}`, timezone: ANALYTICS_TIME_ZONE } });
  const [sessDays, pvDays] = await Promise.all([
    WebSession.aggregate<{ _id: string; n: number }>([{ $match: inRange("startedAt", r) }, { $group: { _id: day("startedAt"), n: { $sum: 1 } } }]),
    WebPageView.aggregate<{ _id: string; views: number; cookieless: number }>([
      { $match: inRange("at", r) },
      { $group: { _id: day("at"), views: { $sum: 1 }, cookieless: { $sum: { $cond: [{ $and: [{ $eq: ["$consented", false] }, "$entry"] }, 1, 0] } } } },
    ]),
  ]);
  const sessByDay = new Map(sessDays.map((d) => [d._id, d.n]));
  const pvByDay = new Map(pvDays.map((d) => [d._id, d]));
  const days: string[] = [];
  for (let d = r.from!; d <= r.to! && days.length < 400; d = new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) days.push(d);

  const unique = sess?.visitors.length ?? 0;
  const returning = sess?.returning.length ?? 0;
  const cookieless = pv?.cookieless ?? 0;
  return {
    visits: (sess?.sessions ?? 0) + cookieless,
    cookielessVisits: cookieless,
    uniqueVisitors: unique,
    newVisitors: unique - returning,
    returningVisitors: returning,
    sessions: sess?.sessions ?? 0,
    pageViews: pv?.pageViews ?? 0,
    avgSessionSeconds: Math.round((sess?.duration ?? 0) / 1000),
    enquiries,
    linkedEnquiries: sess?.enquiries ?? 0,
    daily: days.map((d) => ({ day: d, visits: (sessByDay.get(d) ?? 0) + (pvByDay.get(d)?.cookieless ?? 0), pageViews: pvByDay.get(d)?.views ?? 0 })),
  };
}

/* ───────────── Sources & campaigns ───────────── */

export type PerformanceRow = { key: string; label: string; source?: string; medium?: string; visitors: number; sessions: number; cookielessVisits: number; pageViews: number; enquiries: number; conversionRate: number | null };

const rate = (converted: number, sessions: number) => (sessions > 0 ? converted / sessions : null);

async function performance(r: AnalyticsRange, by: "channel" | "campaign"): Promise<PerformanceRow[]> {
  const key = by === "channel" ? { channel: "$channel" } : { campaign: "$utm.campaign", source: "$utm.source", medium: "$utm.medium" };
  const sessMatch = by === "campaign" ? { ...inRange("startedAt", r), "utm.campaign": { $nin: [null, ""] } } : inRange("startedAt", r);
  const pvMatch = { ...inRange("at", r), consented: false, entry: true, ...(by === "campaign" && { "utm.campaign": { $nin: [null, ""] } }) };
  const [sessions, cookieless] = await Promise.all([
    WebSession.aggregate<{ _id: Record<string, string>; visitors: unknown[]; sessions: number; pageViews: number; enquiries: number; converted: number }>([
      { $match: sessMatch },
      { $group: { _id: key, visitors: { $addToSet: "$visitorId" }, sessions: { $sum: 1 }, pageViews: { $sum: "$pageViews" }, enquiries: { $sum: "$enquiries" }, converted: { $sum: { $cond: [{ $gt: ["$enquiries", 0] }, 1, 0] } } } },
    ]),
    WebPageView.aggregate<{ _id: Record<string, string>; n: number }>([{ $match: pvMatch }, { $group: { _id: key, n: { $sum: 1 } } }]),
  ]);
  const rows = new Map<string, PerformanceRow>();
  const rowFor = (id: Record<string, string>) => {
    const k = by === "channel" ? (id.channel ?? "direct") : [id.campaign, id.source ?? "", id.medium ?? ""].join("\u0000");
    let row = rows.get(k);
    if (!row) {
      row = { key: k, label: by === "channel" ? channelLabel(id.channel) : id.campaign!, source: id.source, medium: id.medium, visitors: 0, sessions: 0, cookielessVisits: 0, pageViews: 0, enquiries: 0, conversionRate: null };
      rows.set(k, row);
    }
    return row;
  };
  for (const s of sessions) Object.assign(rowFor(s._id), { visitors: s.visitors.length, sessions: s.sessions, pageViews: s.pageViews, enquiries: s.enquiries, conversionRate: rate(s.converted, s.sessions) });
  for (const c of cookieless) {
    const row = rowFor(c._id);
    row.cookielessVisits = c.n;
    row.pageViews += c.n;
  }
  const order = (k: string) => (by === "channel" ? CHANNELS.indexOf(k as Channel) : 0);
  return [...rows.values()].sort((a, b) => b.sessions + b.cookielessVisits - (a.sessions + a.cookielessVisits) || order(a.key) - order(b.key));
}

export async function getSources(actor: Actor, r: AnalyticsRange) {
  requireOwner(actor);
  return performance(r, "channel");
}

export async function getCampaigns(actor: Actor, r: AnalyticsRange) {
  requireOwner(actor);
  return performance(r, "campaign");
}

/* ───────────── Pages & services ───────────── */

export type PageRow = { page: string; views: number; visitors: number; landings: number };

export async function getPages(actor: Actor, r: AnalyticsRange, limit = 25): Promise<PageRow[]> {
  requireOwner(actor);
  const rows = await WebPageView.aggregate<{ _id: string; views: number; visitors: unknown[]; landings: number }>([
    { $match: inRange("at", r) },
    { $group: { _id: "$page", views: { $sum: 1 }, visitors: { $addToSet: "$visitorId" }, landings: { $sum: { $cond: ["$entry", 1, 0] } } } },
    { $sort: { views: -1, _id: 1 } },
    { $limit: limit },
  ]);
  return rows.map((p) => ({ page: p._id, views: p.views, visitors: p.visitors.filter(Boolean).length, landings: p.landings }));
}

export type ServiceRow = { slug: string; name: string; active: boolean; views: number; visitors: number; returningVisitors: number; landings: number; visits: number; enquiries: number; conversionRate: number | null };

/**
 * Interest per service, keyed by the Service Management slug (renamed or new services work
 * without code changes). Enquiries are contact-form submissions sent from that service's page.
 */
export async function getServicePerformance(actor: Actor, r: AnalyticsRange): Promise<ServiceRow[]> {
  requireOwner(actor);
  const [services, views, enquiries] = await Promise.all([
    Service.find({ deletedAt: null }).select("slug name active displayOrder").sort({ displayOrder: 1, name: 1 }).lean<{ slug: string; name: string; active?: boolean }[]>(),
    WebPageView.aggregate<{ _id: string; views: number; visitors: unknown[]; sessions: Types.ObjectId[]; landings: number; cookieless: number }>([
      { $match: { ...inRange("at", r), serviceSlug: { $nin: [null, ""] } } },
      {
        $group: {
          _id: "$serviceSlug",
          views: { $sum: 1 },
          visitors: { $addToSet: "$visitorId" },
          sessions: { $addToSet: "$sessionId" },
          landings: { $sum: { $cond: ["$entry", 1, 0] } },
          cookieless: { $sum: { $cond: [{ $eq: ["$consented", false] }, 1, 0] } },
        },
      },
    ]),
    ContactRequest.aggregate<{ _id: string; n: number }>([{ $match: { ...inRange("createdAt", r), serviceSlug: { $nin: [null, ""] }, isDemo: { $ne: true } } }, { $group: { _id: "$serviceSlug", n: { $sum: 1 } } }]),
  ]);
  const allSessions = views.flatMap((v) => v.sessions.filter(Boolean));
  // Session → visitor, for sessions that were a return visit.
  const returningBySession = new Map(
    (await WebSession.find({ _id: { $in: allSessions }, sessionNo: { $gt: 1 } }).select("_id visitorId").lean<{ _id: Types.ObjectId; visitorId: Types.ObjectId }[]>()).map((s) => [String(s._id), String(s.visitorId)]),
  );
  const viewBySlug = new Map(views.map((v) => [v._id, v]));
  const enquiryBySlug = new Map(enquiries.map((e) => [e._id, e.n]));
  return services
    .map((s) => {
      const v = viewBySlug.get(s.slug);
      const sessions = (v?.sessions ?? []).filter(Boolean).map(String);
      const returning = new Set(sessions.map((id) => returningBySession.get(id)).filter(Boolean));
      // A visit = a tracked session that viewed the page, or one cookieless page view.
      const visits = sessions.length + (v?.cookieless ?? 0);
      const enq = enquiryBySlug.get(s.slug) ?? 0;
      return { slug: s.slug, name: s.name, active: !!s.active, views: v?.views ?? 0, visitors: (v?.visitors ?? []).filter(Boolean).length, returningVisitors: returning.size, landings: v?.landings ?? 0, visits, enquiries: enq, conversionRate: visits > 0 ? Math.min(1, enq / visits) : null };
    })
    .sort((a, b) => b.views - a.views || b.enquiries - a.enquiries);
}

/* ───────────── Visitors ───────────── */

export type VisitorStatus = "Lead" | "Authenticated" | "Returning" | "New";
export type VisitorRow = {
  id: string;
  label: string;
  firstSeen: Date;
  lastSeen: Date;
  totalSessions: number;
  sessionsInRange: number;
  pageViews: number;
  pageViewsInRange: number;
  source: string;
  status: VisitorStatus;
  userName?: string;
};

function statusOf(v: Pick<WebVisitorDoc, "contactRequestIds" | "userId" | "sessions">): VisitorStatus {
  if ((v.contactRequestIds?.length ?? 0) > 0) return "Lead";
  if (v.userId) return "Authenticated";
  return (v.sessions ?? 0) > 1 ? "Returning" : "New";
}

const PAGE_SIZE = 25;

/** Visitors with at least one session in the range (anonymous unless they logged in or sent an enquiry). */
export async function listVisitors(actor: Actor, r: AnalyticsRange, opts: { page?: number; limit?: number } = {}) {
  requireOwner(actor);
  const page = Math.max(1, opts.page ?? 1);
  const limit = opts.limit ?? PAGE_SIZE;
  const [res] = await WebSession.aggregate<{ items: { _id: Types.ObjectId; sessions: number; pageViews: number; last: Date }[]; total: { n: number }[] }>([
    { $match: inRange("startedAt", r) },
    { $group: { _id: "$visitorId", sessions: { $sum: 1 }, pageViews: { $sum: "$pageViews" }, last: { $max: "$lastSeen" } } },
    { $sort: { last: -1, _id: 1 } },
    { $facet: { items: [{ $skip: (page - 1) * limit }, { $limit: limit }], total: [{ $count: "n" }] } },
  ] as PipelineStage[]);
  const items = res?.items ?? [];
  const visitors = await WebVisitor.find({ _id: { $in: items.map((i) => i._id) } }).lean<WebVisitorDoc[]>();
  const users = await User.find({ _id: { $in: visitors.map((v) => v.userId).filter(Boolean) } }).select("name").lean<{ _id: Types.ObjectId; name: string }[]>();
  const byId = new Map(visitors.map((v) => [String(v._id), v]));
  const userName = new Map(users.map((u) => [String(u._id), u.name]));
  const rows: VisitorRow[] = items.flatMap((i) => {
    const v = byId.get(String(i._id));
    if (!v) return [];
    return [{
      id: String(v._id),
      label: v.label,
      firstSeen: v.firstSeen,
      lastSeen: v.lastSeen,
      totalSessions: v.sessions ?? 0,
      sessionsInRange: i.sessions,
      pageViews: v.pageViews ?? 0,
      pageViewsInRange: i.pageViews,
      source: channelLabel(v.firstChannel),
      status: statusOf(v),
      userName: v.userId ? userName.get(String(v.userId)) : undefined,
    }];
  });
  const total = res?.total[0]?.n ?? 0;
  return { items: rows, total, page, pageCount: Math.max(1, Math.ceil(total / limit)) };
}

export type VisitorDetail = {
  id: string;
  label: string;
  status: VisitorStatus;
  firstSeen: Date;
  lastSeen: Date;
  totalSessions: number;
  totalPageViews: number;
  source: string;
  firstReferrerDomain?: string;
  firstUtm?: { source?: string; medium?: string; campaign?: string; term?: string; content?: string };
  firstLandingPage?: string;
  user?: { id: string; name: string; email: string; role: string };
  enquiries: { id: string; name: string; company?: string; email: string; createdAt: Date; serviceSlug?: string; status: string }[];
  sessions: {
    id: string;
    sessionNo: number;
    startedAt: Date;
    lastSeen: Date;
    durationSeconds: number;
    channel: string;
    referrerDomain?: string;
    campaign?: string;
    enquiries: number;
    pages: { at: Date; page: string; path: string }[];
  }[];
};

/** One visitor's timeline. Identity (account or enquiry) appears only when the visitor provided it themselves. */
export async function getVisitor(actor: Actor, id: string): Promise<VisitorDetail> {
  requireOwner(actor);
  if (!Types.ObjectId.isValid(id)) throw Errors.notFound();
  const v = await WebVisitor.findById(id).lean<WebVisitorDoc>();
  if (!v) throw Errors.notFound();
  const [sessions, views, user, enquiries] = await Promise.all([
    WebSession.find({ visitorId: v._id }).sort({ startedAt: -1 }).limit(50).lean<WebSessionDoc[]>(),
    WebPageView.find({ visitorId: v._id }).sort({ at: 1 }).limit(2000).select("at page path sessionId").lean<{ at: Date; page: string; path: string; sessionId: Types.ObjectId }[]>(),
    v.userId ? User.findById(v.userId).select("name email role").lean<{ _id: Types.ObjectId; name: string; email: string; role: string }>() : null,
    ContactRequest.find({ _id: { $in: v.contactRequestIds ?? [] } }).select("name company email createdAt serviceSlug status").sort({ createdAt: -1 }).lean<{ _id: Types.ObjectId; name: string; company?: string; email: string; createdAt: Date; serviceSlug?: string; status: string }[]>(),
  ]);
  const bySession = new Map<string, { at: Date; page: string; path: string }[]>();
  for (const p of views) {
    const k = String(p.sessionId);
    bySession.set(k, [...(bySession.get(k) ?? []), { at: p.at, page: p.page, path: p.path }]);
  }
  return {
    id: String(v._id),
    label: v.label,
    status: statusOf(v),
    firstSeen: v.firstSeen,
    lastSeen: v.lastSeen,
    totalSessions: v.sessions ?? 0,
    totalPageViews: v.pageViews ?? 0,
    source: channelLabel(v.firstChannel),
    firstReferrerDomain: v.firstReferrerDomain ?? undefined,
    firstUtm: (v.firstUtm as VisitorDetail["firstUtm"]) ?? undefined,
    firstLandingPage: v.firstLandingPage ?? undefined,
    user: user ? { id: String(user._id), name: user.name, email: user.email, role: user.role } : undefined,
    enquiries: enquiries.map((e) => ({ id: String(e._id), name: e.name, company: e.company ?? undefined, email: e.email, createdAt: e.createdAt, serviceSlug: e.serviceSlug ?? undefined, status: e.status })),
    sessions: sessions.map((s) => ({
      id: String(s._id),
      sessionNo: s.sessionNo,
      startedAt: s.startedAt,
      lastSeen: s.lastSeen,
      durationSeconds: Math.round((s.lastSeen.getTime() - s.startedAt.getTime()) / 1000),
      channel: channelLabel(s.channel),
      referrerDomain: s.referrerDomain ?? undefined,
      campaign: s.utm?.campaign ?? undefined,
      enquiries: s.enquiries ?? 0,
      pages: bySession.get(String(s._id)) ?? [],
    })),
  };
}

/* ───────────── CSV export ───────────── */

export const EXPORT_KINDS = ["visitors", "sessions", "pageviews", "sources", "campaigns"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];
const EXPORT_MAX = 50_000;

/** CSV exports. No IP addresses, no names or emails — behaviour and attribution only. */
export async function exportAnalyticsCsv(actor: Actor, kind: string, r: AnalyticsRange): Promise<{ csv: string; rows: number; filename: string }> {
  requireOwner(actor);
  if (!(EXPORT_KINDS as readonly string[]).includes(kind)) throw Errors.badRequest("Unknown export");
  let header: string[] = [];
  let rows: unknown[][] = [];
  if (kind === "visitors") {
    const { items } = await listVisitors(actor, r, { limit: EXPORT_MAX });
    header = ["visitor", "first_seen", "last_seen", "sessions_total", "sessions_in_range", "page_views_in_range", "first_source", "status"];
    rows = items.map((v) => [`#${v.label}`, v.firstSeen, v.lastSeen, v.totalSessions, v.sessionsInRange, v.pageViewsInRange, v.source, v.status]);
  } else if (kind === "sessions") {
    const sessions = await WebSession.find(inRange("startedAt", r)).sort({ startedAt: -1 }).limit(EXPORT_MAX).lean<WebSessionDoc[]>();
    const labels = new Map((await WebVisitor.find({ _id: { $in: sessions.map((s) => s.visitorId) } }).select("label").lean<{ _id: Types.ObjectId; label: string }[]>()).map((v) => [String(v._id), v.label]));
    header = ["visitor", "session_no", "started_at", "last_activity_at", "duration_seconds", "page_views", "landing_page", "exit_page", "channel", "referrer_domain", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "enquiries"];
    rows = sessions.map((s) => [`#${labels.get(String(s.visitorId)) ?? "?"}`, s.sessionNo, s.startedAt, s.lastSeen, Math.round((s.lastSeen.getTime() - s.startedAt.getTime()) / 1000), s.pageViews, s.landingPage, s.exitPage, channelLabel(s.channel), s.referrerDomain, s.utm?.source, s.utm?.medium, s.utm?.campaign, s.utm?.term, s.utm?.content, s.enquiries]);
  } else if (kind === "pageviews") {
    const views = await WebPageView.find(inRange("at", r)).sort({ at: -1 }).limit(EXPORT_MAX).select("at page path locale consented visitorId entry channel referrerDomain utm").lean<{ at: Date; page: string; path: string; locale?: string; consented: boolean; visitorId?: Types.ObjectId; entry?: boolean; channel?: string; referrerDomain?: string; utm?: { source?: string; medium?: string; campaign?: string } }[]>();
    const labels = new Map((await WebVisitor.find({ _id: { $in: views.map((v) => v.visitorId).filter(Boolean) } }).select("label").lean<{ _id: Types.ObjectId; label: string }[]>()).map((v) => [String(v._id), v.label]));
    header = ["viewed_at", "page", "path", "language", "visitor", "analytics_consent", "visit_entry", "channel", "referrer_domain", "utm_source", "utm_medium", "utm_campaign"];
    rows = views.map((v) => [v.at, v.page, v.path, v.locale, v.visitorId ? `#${labels.get(String(v.visitorId)) ?? "?"}` : "", v.consented ? "yes" : "no", v.entry ? "yes" : "no", v.channel ? channelLabel(v.channel) : "", v.referrerDomain, v.utm?.source, v.utm?.medium, v.utm?.campaign]);
  } else {
    const perf = kind === "sources" ? await getSources(actor, r) : await getCampaigns(actor, r);
    header = [kind === "sources" ? "source" : "campaign", "utm_source", "utm_medium", "visitors", "sessions", "visits_without_consent", "page_views", "enquiries", "conversion_rate"];
    rows = perf.map((p) => [p.label, p.source, p.medium, p.visitors, p.sessions, p.cookielessVisits, p.pageViews, p.enquiries, p.conversionRate === null ? "" : p.conversionRate.toFixed(4)]);
  }
  // BOM so Excel opens UTF-8 (Ø, Å, Ä…) correctly.
  const csv = `﻿${[header.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\r\n")}\r\n`;
  return { csv, rows: rows.length, filename: `website-${kind}-${r.from}-${r.to}.csv` };
}
