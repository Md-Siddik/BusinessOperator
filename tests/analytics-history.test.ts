import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ContactRequest, WebAnalyticsDaily, WebConversion, WebEventKey, WebPageView, WebSession, WebVisitor, type WebAnalyticsDailyDoc } from "@/models";
import type { SessionUser } from "@/lib/auth/actor";
import type { Actor } from "@/lib/permissions";
import { createConsent, serializeConsent } from "@/lib/consent";
import { expectRejects, makeTenants } from "./helpers";

/**
 * Requirement 3: permanent, date-based analytics. Daily roll-ups survive raw-record expiry,
 * Norwegian day boundaries, weekly / monthly periods, lead conversions with first/last-touch
 * attribution, anonymous leads, idempotency, Owner-only access and PII-free exports.
 */
const session = vi.hoisted(() => ({ current: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => session.current,
  getActor: async () => session.current?.actor ?? null,
}));

const { recordEvent, recordConversion, enquiryConversionType } = await import("@/features/website-analytics/collect");
const { rollupDay, rollupPending } = await import("@/features/website-analytics/rollup");
const history = await import("@/features/website-analytics/history");
const { analyticsRange } = await import("@/features/website-analytics/service");
const { resetRateLimits } = await import("@/lib/rate-limit");
const { POST: contactRoute } = await import("@/app/api/contact/route");
const { GET: exportRoute } = await import("@/app/api/website-analytics/export/route");

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const HOST = "exploretechify.com";
const GRANTED = `et_consent=${serializeConsent(createConsent("granted"))}`;
const at = (iso: string) => new Date(iso);
const range = (from: string, to = from) => analyticsRange({ range: "custom", from, to });
const ctx = { params: Promise.resolve({}) };

let t: Awaited<ReturnType<typeof makeTenants>>;
function as(user: { actor: Actor } | null) {
  session.current = user ? { id: user.actor.id, name: user.actor.name, email: user.actor.email, role: user.actor.role, status: "ACTIVE", organizationId: user.actor.organizationId, organizationStatus: "ACTIVE", emailVerifiedAt: new Date(), actor: user.actor } : null;
}
function browser(ua = CHROME) {
  let vid: string | undefined;
  return {
    get vid() {
      return vid;
    },
    async view(url: string, when: Date, referrer?: string) {
      const r = await recordEvent({ url, referrer }, { userAgent: ua, host: HOST, consent: true, vid, now: when });
      vid ??= r.newVid;
      return r;
    },
  };
}
const post = (url: string, body: unknown, cookie = "") => new NextRequest(new URL(url, `https://${HOST}`), { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "user-agent": CHROME, host: HOST, ...(cookie && { cookie }) } });

beforeAll(async () => {
  t = await makeTenants();
});
beforeEach(async () => {
  resetRateLimits();
  as(null);
  await Promise.all([WebVisitor, WebSession, WebPageView, ContactRequest, WebEventKey, WebConversion, WebAnalyticsDaily].map((m) => (m as typeof WebVisitor).deleteMany({})));
});

describe("Daily roll-up", () => {
  it("stores one row per Norwegian day with visitors, sessions, page views, devices, sources and leads", async () => {
    const a = browser();
    await a.view("/?utm_source=linkedin&utm_medium=social&utm_campaign=autumn", at("2026-10-20T08:00:00Z"), "https://www.linkedin.com/");
    await a.view("/services/seo", at("2026-10-20T08:02:00Z"), `https://${HOST}/`);
    const b = browser(IPHONE);
    await b.view("/", at("2026-10-20T09:00:00Z"), "https://www.google.com/");
    await ContactRequest.create({ name: "Lead One", email: "lead1@example.test", message: "We would like a quote please.", preferredContact: "video", createdAt: at("2026-10-20T09:30:00Z") });
    await ContactRequest.create({ name: "Lead Two", email: "lead2@example.test", message: "Please email me details.", createdAt: at("2026-10-20T10:30:00Z") });

    const row = (await rollupDay("2026-10-20", at("2026-10-28T12:00:00Z")))!;
    expect(row).toMatchObject({ day: "2026-10-20", timeZone: "Europe/Oslo", uniqueVisitors: 2, sessions: 2, pageViews: 3, leads: 2, consultationRequests: 1, contactForms: 1, final: true });
    expect(row.devices.map((d) => [d.key, d.sessions])).toEqual(expect.arrayContaining([["desktop", 1], ["mobile", 1]]));
    expect(row.sources.map((s) => s.key).sort()).toEqual(["google", "linkedin"]);
    expect(row.pages.find((p) => p.key === "/")?.pageViews).toBe(2);
  });

  it("counts a repeated page load as one visitor, not a new person", async () => {
    const a = browser();
    for (let i = 0; i < 5; i++) await a.view("/", at(`2026-10-21T08:0${i}:00Z`));
    const row = (await rollupDay("2026-10-21", at("2026-10-28T12:00:00Z")))!;
    expect(row).toMatchObject({ uniqueVisitors: 1, sessions: 1, pageViews: 5 });
  });

  it("uses Norwegian calendar days: 23:30 UTC on 22 Oct belongs to 23 Oct", async () => {
    await browser().view("/about", at("2026-10-22T23:30:00Z"));
    expect((await rollupDay("2026-10-22", at("2026-10-28T12:00:00Z")))!.sessions).toBe(0);
    expect((await rollupDay("2026-10-23", at("2026-10-28T12:00:00Z")))!.sessions).toBe(1);
  });

  it("keeps history after the raw records expire — a frozen day is never recomputed or lowered", async () => {
    const a = browser();
    await a.view("/", at("2026-10-01T08:00:00Z"));
    await a.view("/contact", at("2026-10-01T08:01:00Z"), `https://${HOST}/`);
    const first = (await rollupDay("2026-10-01", at("2026-10-28T12:00:00Z")))!;
    expect(first).toMatchObject({ final: true, pageViews: 2, uniqueVisitors: 1 });
    // The TTL index removes the raw records.
    await Promise.all([WebPageView.deleteMany({}), WebSession.deleteMany({}), WebVisitor.deleteMany({})]);
    expect(await rollupDay("2026-10-01", at("2026-10-29T12:00:00Z"))).toBeNull();
    await rollupPending(at("2026-10-29T12:00:00Z"));
    const kept = await WebAnalyticsDaily.findOne({ day: "2026-10-01" }).lean<WebAnalyticsDailyDoc>();
    expect(kept).toMatchObject({ pageViews: 2, uniqueVisitors: 1, final: true });
    const h = await history.getHistory(t.owner.actor, range("2026-10-01"), "day");
    expect(h.totals).toMatchObject({ pageViews: 2, uniqueVisitors: 1 });
  });

  it("recomputes today and yesterday (late events), then freezes them", async () => {
    const now = at("2026-10-28T12:00:00Z");
    await browser().view("/", at("2026-10-28T08:00:00Z"));
    expect((await rollupDay("2026-10-28", now))!).toMatchObject({ pageViews: 1, final: false });
    await browser().view("/", at("2026-10-28T09:00:00Z"));
    expect((await rollupDay("2026-10-28", now))!).toMatchObject({ pageViews: 2, uniqueVisitors: 2, final: false });
    expect((await rollupDay("2026-10-28", at("2026-10-30T12:00:00Z")))!.final).toBe(true);
  });

  it("backfills every day that still has raw records, idempotently, without inventing empty-day data", async () => {
    await browser().view("/", at("2026-10-10T08:00:00Z"));
    await browser().view("/", at("2026-10-12T08:00:00Z"));
    const now = at("2026-10-14T12:00:00Z");
    const r1 = await rollupPending(now);
    expect(r1.from).toBe("2026-10-10");
    const rows = await WebAnalyticsDaily.find().sort({ day: 1 }).lean<WebAnalyticsDailyDoc[]>();
    expect(rows.map((r) => [r.day, r.pageViews])).toEqual([["2026-10-10", 1], ["2026-10-11", 0], ["2026-10-12", 1], ["2026-10-13", 0], ["2026-10-14", 0]]);
    await rollupPending(now);
    expect(await WebAnalyticsDaily.countDocuments()).toBe(5);
  });
});

describe("Historical reporting", () => {
  async function seedMonth() {
    // 6 – 19 Oct 2026: one visit a day on five days; the same browser on 7 and 13 Oct.
    const same = browser();
    await same.view("/", at("2026-10-07T08:00:00Z"));
    await same.view("/", at("2026-10-13T08:00:00Z"));
    for (const d of ["06", "08", "14"]) await browser().view("/services/seo", at(`2026-10-${d}T08:00:00Z`), "https://www.google.com/");
    for (const d of ["06", "07", "08", "13", "14", "19"]) await rollupDay(`2026-10-${d}`, at("2026-10-28T12:00:00Z"));
  }

  it("groups by week and month, with exact unique visitors while raw sessions exist", async () => {
    await seedMonth();
    const week = await history.getHistory(t.owner.actor, range("2026-10-06", "2026-10-19"), "week");
    // Weeks start on Monday; 19 Oct 2026 is a Monday, so it opens its own (partial) week.
    expect(week.periods.map((p) => [p.period, p.sessions])).toEqual([["2026-10-19", 0], ["2026-10-12", 2], ["2026-10-05", 3]]);
    const month = await history.getHistory(t.owner.actor, range("2026-10-06", "2026-10-19"), "month");
    expect(month.periods).toHaveLength(1);
    expect(month.periods[0]).toMatchObject({ period: "2026-10-01", sessions: 5, pageViews: 5 });
    // The oldest raw day (6 Oct) may be partly expired, so a range starting there is not "exact".
    expect(month.totals).toMatchObject({ uniqueVisitors: 5, uniqueExact: false });
    // From 7 Oct raw sessions are complete: the same browser on two days is one visitor (3 distinct, not 4).
    const later = await history.getHistory(t.owner.actor, range("2026-10-07", "2026-10-19"), "month");
    expect(later.totals).toMatchObject({ uniqueVisitors: 3, uniqueExact: true, sessions: 4 });
  });

  it("falls back to the sum of daily unique visitors, clearly marked, once raw sessions have expired", async () => {
    await seedMonth();
    await WebSession.deleteMany({});
    const month = await history.getHistory(t.owner.actor, range("2026-10-06", "2026-10-19"), "month");
    expect(month.totals).toMatchObject({ uniqueVisitors: 5, uniqueExact: false, sessions: 5 });
  });

  it("compares with the previous period of the same length and merges source attribution", async () => {
    await seedMonth();
    const h = await history.getHistory(t.owner.actor, range("2026-10-13", "2026-10-19"), "day");
    expect(h.previous).toMatchObject({ from: "2026-10-06", to: "2026-10-12", sessions: 3 });
    expect(h.totals.sessions).toBe(2);
    expect(h.sources.find((s) => s.key === "google")).toMatchObject({ sessions: 1, label: "Google" });
    expect(h.periods).toHaveLength(7);
  });
});

describe("Leads and attribution", () => {
  const enquiry = { name: "Kari Nordmann", company: "Fjord AS", email: "kari@fjord.example", phone: "+47 400 00 000", message: "We would like a new website.", preferredContact: "phone" };

  it("records a consented lead with first- and last-touch attribution, and copies it onto the enquiry", async () => {
    const b = browser();
    await b.view("/?utm_source=linkedin&utm_medium=social&utm_campaign=spring", at("2026-10-01T08:00:00Z"), "https://www.linkedin.com/");
    await b.view("/services/seo", new Date(Date.now() - 60_000), "https://www.google.com/");
    const res = await contactRoute(post("/api/contact", enquiry, `${GRANTED}; et_vid=${b.vid}`), ctx);
    expect(res.status).toBe(200);
    const c = await WebConversion.findOne().lean<{ type: string; consented: boolean; firstTouch: { channel: string; utm: { campaign: string } }; lastTouch: { channel: string; landingPage: string } }>();
    expect(c).toMatchObject({ type: "consultation_request", consented: true, firstTouch: { channel: "linkedin", utm: { campaign: "spring" } }, lastTouch: { channel: "google", landingPage: "/services/seo" } });
    const cr = await ContactRequest.findOne().lean<{ attribution: { conversionType: string; firstTouch: { campaign: string }; lastTouch: { channel: string } } }>();
    expect(cr!.attribution).toMatchObject({ conversionType: "consultation_request", firstTouch: { campaign: "spring" }, lastTouch: { channel: "google" } });

    const leads = await history.listLeads(t.owner.actor, range(new Date().toISOString().slice(0, 10)));
    expect(leads.items[0]).toMatchObject({ type: "consultation_request", contact: { name: "Kari Nordmann", email: "kari@fjord.example", phone: "+47 400 00 000" } });
    expect(leads.items[0]!.visitor?.label).toMatch(/^[0-9A-Z]{4}$/);
  });

  it("an unconsented lead is counted but Anonymous, with no attribution and no inferred identity", async () => {
    const b = browser();
    await b.view("/", new Date(Date.now() - 60_000));
    // The visitor cookie is present, but there is no valid consent decision.
    await contactRoute(post("/api/contact", { ...enquiry, preferredContact: "email" }, `et_vid=${b.vid}`), ctx);
    const c = await WebConversion.findOne().lean<{ type: string; consented: boolean; visitorId?: unknown; firstTouch?: unknown }>();
    expect(c).toMatchObject({ type: "contact_form", consented: false });
    expect(c!.visitorId).toBeUndefined();
    expect(c!.firstTouch).toBeUndefined();
    expect((await ContactRequest.findOne().lean<{ attribution?: unknown }>())!.attribution).toBeUndefined();
    const leads = await history.listLeads(t.owner.actor, range(new Date().toISOString().slice(0, 10)));
    expect(leads.items[0]!.visitor).toBeNull();
    // Contact details are only what the person typed into the form.
    expect(leads.items[0]!.contact).toEqual({ name: "Kari Nordmann", email: "kari@fjord.example", phone: "+47 400 00 000", company: "Fjord AS" });
  });

  it("is idempotent: the same lead is counted once", async () => {
    const cr = await ContactRequest.create({ name: "Once", email: "once@example.test", message: "Just once, please." });
    for (let i = 0; i < 3; i++) await recordConversion({ type: "contact_form", key: `contact:${cr._id}`, contactRequestId: String(cr._id) });
    expect(await WebConversion.countDocuments()).toBe(1);
    expect(enquiryConversionType("video")).toBe("consultation_request");
    expect(enquiryConversionType(undefined)).toBe("contact_form");
  });
});

describe("Access and exports", () => {
  it("history, leads and their exports are Owner only", async () => {
    for (const u of [t.admin, t.staff, t.clientA]) {
      await expectRejects(history.getHistory(u.actor, range("2026-10-01"), "day"), 403);
      await expectRejects(history.listLeads(u.actor, range("2026-10-01")), 403);
      as(u);
      for (const kind of ["daily", "leads"]) expect((await exportRoute(new NextRequest(new URL(`https://${HOST}/api/website-analytics/export?kind=${kind}&range=custom&from=2026-10-01&to=2026-10-31`)), ctx)).status).toBe(403);
    }
    as(null);
    expect((await exportRoute(new NextRequest(new URL(`https://${HOST}/api/website-analytics/export?kind=daily`)), ctx)).status).toBe(401);
  });

  it("CSV exports contain no names, emails or phone numbers", async () => {
    const b = browser();
    await b.view("/", new Date(Date.now() - 60_000));
    await contactRoute(post("/api/contact", enquiry(), `${GRANTED}; et_vid=${b.vid}`), ctx);
    await rollupPending();
    as(t.owner);
    const today = new Date().toISOString().slice(0, 10);
    for (const kind of ["daily", "leads"]) {
      const res = await exportRoute(new NextRequest(new URL(`https://${HOST}/api/website-analytics/export?kind=${kind}&range=custom&from=${today}&to=${today}`)), ctx);
      expect(res.status).toBe(200);
      const csv = await res.text();
      expect(csv).not.toContain("kari@fjord.example");
      expect(csv).not.toContain("Kari");
      expect(csv).not.toContain("400 00 000");
      expect(Number(res.headers.get("X-Export-Rows"))).toBeGreaterThan(0);
    }
    function enquiry() {
      return { name: "Kari Nordmann", email: "kari@fjord.example", phone: "+47 400 00 000", message: "We would like a new website." };
    }
  });
});
