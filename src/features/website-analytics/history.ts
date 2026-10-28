import "server-only";
import { Types } from "mongoose";
import { ContactRequest, User, WebAnalyticsDaily, WebConversion, WebSession, WebVisitor, type ContactRequestDoc, type UserDoc, type WebAnalyticsDailyDoc, type WebConversionDoc } from "@/models";
import { Errors } from "@/lib/errors";
import { isOwner, type Actor } from "@/lib/permissions";
import { addDays, daysBetween, localRangeUtc, startOfMonth, startOfWeek, type Day } from "@/lib/dates/country-time";
import { csvCell } from "@/features/companies/registrations";
import { ANALYTICS_TIME_ZONE, CHANNEL_LABELS, type Channel } from "./classify";
import type { AnalyticsRange } from "./service";

/**
 * Historical reporting from the durable daily statistics (WebAnalyticsDaily) — OWNER ONLY.
 *
 * Definitions (shown on the dashboard):
 *  - Unique visitors: distinct browsers that accepted analytics. For a single day it is exact.
 *    For a week / month / range it is exact while raw sessions still exist for the whole period;
 *    older periods show the sum of daily unique visitors (a returning browser counts once per day)
 *    and are marked as such. A repeated page load is never a new visitor.
 *  - Sessions: visits of consenting browsers (30 minutes of inactivity ends a visit).
 *  - Page views: every recorded page load.
 *  - Leads: contact-form enquiries (incl. consultation requests) and client sign-ups — all of
 *    them, consented or not. Conversion rate: tracked sessions that produced a lead ÷ tracked sessions.
 *  - Every day is a calendar day in Europe/Oslo.
 */

function requireOwner(actor: Actor | null | undefined) {
  if (!isOwner(actor)) throw Errors.forbidden();
}

export const GRANULARITIES = ["day", "week", "month"] as const;
export type Granularity = (typeof GRANULARITIES)[number];
export const parseGranularity = (v: string | undefined): Granularity => ((GRANULARITIES as readonly string[]).includes(v ?? "") ? (v as Granularity) : "day");

const bucketOf = (day: Day, g: Granularity) => (g === "day" ? day : g === "week" ? startOfWeek(day) : startOfMonth(day));

export type PeriodRow = {
  period: Day;
  /** Last day of the period inside the selected range. */
  to: Day;
  uniqueVisitors: number;
  /** false: sum of daily unique visitors (raw sessions for the whole period have expired). */
  uniqueExact: boolean;
  sessions: number;
  pageViews: number;
  cookielessVisits: number;
  leads: number;
  contactForms: number;
  consultationRequests: number;
  clientSignups: number;
  convertedSessions: number;
  conversionRate: number | null;
  partial: boolean;
};

export type Totals = Omit<PeriodRow, "period" | "to" | "partial"> & { days: number };
type KeyRow = { key: string; label: string; visitors: number; sessions: number; pageViews: number; conversions: number; conversionRate: number | null };

const rate = (n: number, d: number) => (d > 0 ? n / d : null);

async function dailyRows(from: Day, to: Day) {
  return WebAnalyticsDaily.find({ day: { $gte: from, $lte: to } }).sort({ day: 1 }).lean<WebAnalyticsDailyDoc[]>();
}

/** Distinct consenting browsers with a session in [from, to] — only when raw sessions cover the whole period. */
async function exactUniques(from: Day, to: Day, oldestRaw: Day | null) {
  if (!oldestRaw || from < oldestRaw) return null;
  const { start, end } = localRangeUtc(from, to, ANALYTICS_TIME_ZONE);
  const ids = await WebSession.distinct("visitorId", { startedAt: { $gte: start, $lt: end } });
  return ids.length;
}

async function oldestRawDay() {
  const s = await WebSession.findOne().sort({ startedAt: 1 }).select("startedAt").lean<{ startedAt: Date }>();
  if (!s) return null;
  // The first raw day may itself be incomplete (records expiring through it), so only later days count as covered.
  return addDays(new Intl.DateTimeFormat("en-CA", { timeZone: ANALYTICS_TIME_ZONE }).format(s.startedAt), 1);
}

function sumRows(rows: WebAnalyticsDailyDoc[]) {
  const t = { uniqueVisitors: 0, sessions: 0, pageViews: 0, cookielessVisits: 0, leads: 0, contactForms: 0, consultationRequests: 0, clientSignups: 0, convertedSessions: 0 };
  for (const r of rows) for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += r[k] ?? 0;
  return t;
}

async function totalsFor(from: Day, to: Day, oldestRaw: Day | null): Promise<Totals> {
  const rows = await dailyRows(from, to);
  const s = sumRows(rows);
  const exact = await exactUniques(from, to, oldestRaw);
  return { ...s, uniqueVisitors: exact ?? s.uniqueVisitors, uniqueExact: exact !== null || from === to, conversionRate: rate(s.convertedSessions, s.sessions), days: daysBetween(from, to) + 1 };
}

export type History = {
  granularity: Granularity;
  timeZone: string;
  periods: PeriodRow[];
  page: number;
  pageCount: number;
  totalPeriods: number;
  totals: Totals;
  previous: Totals & { from: Day; to: Day };
  sources: KeyRow[];
  pages: KeyRow[];
  devices: KeyRow[];
  daysWithData: number;
  partialDays: number;
};

const PAGE_SIZE = 31;

export async function getHistory(actor: Actor, r: AnalyticsRange, granularity: Granularity, page = 1): Promise<History> {
  requireOwner(actor);
  const from = r.from!;
  const to = r.to!;
  const [rows, oldestRaw] = await Promise.all([dailyRows(from, to), oldestRawDay()]);

  // Periods, newest first.
  const buckets = new Map<Day, WebAnalyticsDailyDoc[]>();
  for (let d = to; d >= from; d = addDays(d, -1)) {
    const b = bucketOf(d, granularity);
    if (!buckets.has(b)) buckets.set(b, []);
  }
  for (const row of rows) buckets.get(bucketOf(row.day, granularity))?.push(row);
  const keys = [...buckets.keys()];
  const pageCount = Math.max(1, Math.ceil(keys.length / PAGE_SIZE));
  const p = Math.min(Math.max(1, page), pageCount);
  const visible = keys.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
  const periods: PeriodRow[] = [];
  for (const key of visible) {
    const list = buckets.get(key)!;
    const start = key < from ? from : key;
    const end = granularity === "day" ? key : granularity === "week" ? addDays(key, 6) : addDays(startOfMonth(addDays(key, 32)), -1);
    const last = end > to ? to : end;
    const s = sumRows(list);
    const exact = granularity === "day" ? null : await exactUniques(start, last, oldestRaw);
    periods.push({ period: key, to: last, ...s, uniqueVisitors: exact ?? s.uniqueVisitors, uniqueExact: granularity === "day" || exact !== null, conversionRate: rate(s.convertedSessions, s.sessions), partial: list.some((x) => x.partial) });
  }

  const length = daysBetween(from, to) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(length - 1));
  const [totals, previous] = await Promise.all([totalsFor(from, to, oldestRaw), totalsFor(prevFrom, prevTo, oldestRaw)]);

  const merge = (field: "sources" | "pages" | "devices", label: (k: string) => string): KeyRow[] => {
    const m = new Map<string, KeyRow>();
    for (const row of rows) {
      for (const x of row[field] ?? []) {
        const key = x.key ?? "unknown";
        const cur = m.get(key) ?? { key, label: label(key), visitors: 0, sessions: 0, pageViews: 0, conversions: 0, conversionRate: null };
        cur.visitors += x.visitors ?? 0;
        cur.sessions += x.sessions ?? 0;
        cur.pageViews += x.pageViews ?? 0;
        cur.conversions += x.conversions ?? 0;
        m.set(key, cur);
      }
    }
    return [...m.values()].map((x) => ({ ...x, conversionRate: rate(x.conversions, x.sessions) })).sort((a, b) => b.sessions - a.sessions || b.pageViews - a.pageViews);
  };

  return {
    granularity,
    timeZone: ANALYTICS_TIME_ZONE,
    periods,
    page: p,
    pageCount,
    totalPeriods: keys.length,
    totals,
    previous: { ...previous, from: prevFrom, to: prevTo },
    sources: merge("sources", (k) => CHANNEL_LABELS[k as Channel] ?? (k === "unknown" ? "Unknown" : k)),
    pages: merge("pages", (k) => k).slice(0, 25),
    devices: merge("devices", (k) => (k === "unknown" ? "Unknown (before 2026-10)" : k[0]!.toUpperCase() + k.slice(1))),
    daysWithData: rows.length,
    partialDays: rows.filter((x) => x.partial).length,
  };
}

/* ───────────── Leads & attribution ───────────── */

export type LeadRow = {
  id: string;
  at: Date;
  type: string;
  /** Details the person provided themselves (enquiry form or sign-up). Never inferred. */
  contact: { name?: string; email?: string; phone?: string; company?: string } | null;
  /** Consenting browser's display code and visitor id (for the visit timeline), else null = Anonymous. */
  visitor: { id: string; label: string } | null;
  firstTouch?: WebConversionDoc["firstTouch"];
  lastTouch?: WebConversionDoc["lastTouch"];
  serviceSlug?: string | null;
  contactRequestId?: string;
};

export const CONVERSION_LABELS: Record<string, string> = { contact_form: "Contact form", consultation_request: "Consultation request", client_signup: "Client sign-up" };
const LEADS_PAGE = 25;

export async function listLeads(actor: Actor, r: AnalyticsRange, opts: { page?: number; type?: string } = {}) {
  requireOwner(actor);
  const filter: Record<string, unknown> = { day: { $gte: r.from, $lte: r.to } };
  if (opts.type && CONVERSION_LABELS[opts.type]) filter.type = opts.type;
  const page = Math.max(1, opts.page ?? 1);
  const [items, total] = await Promise.all([
    WebConversion.find(filter).sort({ at: -1 }).skip((page - 1) * LEADS_PAGE).limit(LEADS_PAGE).lean<WebConversionDoc[]>(),
    WebConversion.countDocuments(filter),
  ]);
  const crIds = items.map((i) => i.contactRequestId).filter(Boolean) as Types.ObjectId[];
  const userIds = items.map((i) => i.userId).filter(Boolean) as Types.ObjectId[];
  const visitorIds = items.map((i) => i.visitorId).filter(Boolean) as Types.ObjectId[];
  const [crs, users, visitors] = await Promise.all([
    ContactRequest.find({ _id: { $in: crIds } }).select("name email phone company").lean<ContactRequestDoc[]>(),
    User.find({ _id: { $in: userIds } }).select("name email").lean<UserDoc[]>(),
    WebVisitor.find({ _id: { $in: visitorIds } }).select("label").lean<{ _id: Types.ObjectId; label: string }[]>(),
  ]);
  const crById = new Map(crs.map((c) => [String(c._id), c]));
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const visitorById = new Map(visitors.map((v) => [String(v._id), v]));
  const rows: LeadRow[] = items.map((i) => {
    const cr = i.contactRequestId ? crById.get(String(i.contactRequestId)) : undefined;
    const u = i.userId ? userById.get(String(i.userId)) : undefined;
    const v = i.visitorId ? visitorById.get(String(i.visitorId)) : undefined;
    return {
      id: String(i._id),
      at: i.at,
      type: i.type,
      contact: cr ? { name: cr.name, email: cr.email, phone: cr.phone ?? undefined, company: cr.company ?? undefined } : u ? { name: u.name, email: u.email } : null,
      visitor: v ? { id: String(v._id), label: v.label } : null,
      firstTouch: i.firstTouch,
      lastTouch: i.lastTouch,
      serviceSlug: i.serviceSlug,
      contactRequestId: i.contactRequestId ? String(i.contactRequestId) : undefined,
    };
  });
  return { items: rows, total, page, pageCount: Math.max(1, Math.ceil(total / LEADS_PAGE)) };
}

/* ───────────── CSV ───────────── */

/** Daily statistics or leads for the range. No IP addresses, names, emails or phone numbers. */
export async function exportHistoryCsv(actor: Actor, kind: "daily" | "leads", r: AnalyticsRange) {
  requireOwner(actor);
  let header: string[];
  let rows: unknown[][];
  if (kind === "daily") {
    header = ["date", "time_zone", "unique_visitors", "new_visitors", "returning_visitors", "sessions", "page_views", "visits_without_consent", "avg_session_seconds", "leads", "contact_forms", "consultation_requests", "client_signups", "converted_sessions", "conversion_rate", "final", "partial"];
    rows = (await dailyRows(r.from!, r.to!)).map((d) => [d.day, d.timeZone, d.uniqueVisitors, d.newVisitors, d.returningVisitors, d.sessions, d.pageViews, d.cookielessVisits, d.avgSessionSeconds, d.leads, d.contactForms, d.consultationRequests, d.clientSignups, d.convertedSessions, d.sessions ? (d.convertedSessions / d.sessions).toFixed(4) : "", d.final, d.partial]);
  } else {
    header = ["lead_id", "date_time", "type", "attributed", "first_touch_at", "first_channel", "first_referrer_domain", "first_utm_source", "first_utm_medium", "first_utm_campaign", "first_landing_page", "last_touch_at", "last_channel", "last_referrer_domain", "last_utm_source", "last_utm_medium", "last_utm_campaign", "last_landing_page", "service"];
    const items = await WebConversion.find({ day: { $gte: r.from, $lte: r.to } }).sort({ at: -1 }).limit(50_000).lean<WebConversionDoc[]>();
    const t = (x?: WebConversionDoc["firstTouch"]) => [x?.at ? new Date(x.at).toISOString() : "", x?.channel ?? "", x?.referrerDomain ?? "", x?.utm?.source ?? "", x?.utm?.medium ?? "", x?.utm?.campaign ?? "", x?.landingPage ?? ""];
    rows = items.map((i) => [String(i._id), new Date(i.at).toISOString(), i.type, i.consented, ...t(i.firstTouch), ...t(i.lastTouch), i.serviceSlug ?? ""]);
  }
  const csv = `﻿${[header.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\r\n")}\r\n`;
  return { csv, rows: rows.length, filename: `website-${kind}-${r.from}-${r.to}.csv` };
}
