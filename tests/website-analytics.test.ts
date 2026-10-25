import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { ContactRequest, Service, WebPageView, WebSession, WebVisitor, type WebSessionDoc, type WebVisitorDoc } from "@/models";
import type { SessionUser } from "@/lib/auth/actor";
import type { Actor } from "@/lib/permissions";
import { expectRejects, makeTenants } from "./helpers";

/**
 * Owner-only Website Analytics: collection (consent, visitors, sessions, attribution, bots),
 * lead/user linking, aggregation, date filtering, access control and failure isolation.
 * All data here is throw-away test data in an in-memory database.
 */
const session = vi.hoisted(() => ({ current: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => session.current,
  getActor: async () => session.current?.actor ?? null,
}));

const classify = await import("@/features/website-analytics/classify");
const { recordEvent, linkVisitorToUser } = await import("@/features/website-analytics/collect");
const svc = await import("@/features/website-analytics/service");
const geo = await import("@/features/website-analytics/geo");
const { resetRateLimits } = await import("@/lib/rate-limit");
const { POST: trackRoute } = await import("@/app/api/track/route");
const { POST: consentRoute } = await import("@/app/api/track/consent/route");
const { POST: contactRoute } = await import("@/app/api/contact/route");
const { GET: statsRoute } = await import("@/app/api/website-analytics/route");
const { GET: exportRoute } = await import("@/app/api/website-analytics/export/route");
const { GET: visitorRoute } = await import("@/app/api/website-analytics/visitors/[id]/route");

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const HOST = "exploretechify.com";
const ctx = { params: Promise.resolve({}) };

let t: Awaited<ReturnType<typeof makeTenants>>;
function as(user: { actor: Actor } | null) {
  session.current = user ? { id: user.actor.id, name: user.actor.name, email: user.actor.email, role: user.actor.role, status: "ACTIVE", organizationId: user.actor.organizationId, organizationStatus: "ACTIVE", emailVerifiedAt: new Date(), actor: user.actor } : null;
}
const req = (url: string, init: ConstructorParameters<typeof NextRequest>[1] = {}) => new NextRequest(new URL(url, `https://${HOST}`), init);
const post = (url: string, body: unknown, cookie = "", ua = CHROME) =>
  req(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "user-agent": ua, host: HOST, ...(cookie && { cookie }) } });

/** A consenting browser, as the tracker would drive it (time is controlled through recordEvent). */
async function consentingBrowser() {
  let vid: string | undefined;
  return {
    get vid() {
      return vid;
    },
    async view(url: string, at: Date, extra: { referrer?: string; actor?: Actor | null; ua?: string } = {}) {
      const r = await recordEvent({ url, referrer: extra.referrer }, { userAgent: extra.ua ?? CHROME, host: HOST, consent: true, vid, actor: extra.actor ?? null, now: at });
      vid ??= r.newVid;
      return r;
    },
  };
}
const at = (iso: string) => new Date(iso);
const range = (from: string, to = from) => svc.analyticsRange({ range: "custom", from, to });

beforeAll(async () => {
  t = await makeTenants();
});
beforeEach(async () => {
  resetRateLimits();
  as(null);
  await Promise.all([WebVisitor.deleteMany({}), WebSession.deleteMany({}), WebPageView.deleteMany({}), ContactRequest.deleteMany({})]);
});

/* ───────────── Classification ───────────── */

describe("Classification", () => {
  it("filters obvious bots, crawlers, monitors and automated browsers — not real browsers", () => {
    for (const ua of ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "Mozilla/5.0 (compatible; bingbot/2.0)", "curl/8.4.0", "python-requests/2.31", "Mozilla/5.0 HeadlessChrome/120.0", "UptimeRobot/2.0", "facebookexternalhit/1.1", "", "x"]) expect(classify.isBot(ua), ua).toBe(true);
    expect(classify.isBot(CHROME, true)).toBe(true); // navigator.webdriver
    for (const ua of [CHROME, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5; rv:131.0) Gecko/20100101 Firefox/131.0"]) expect(classify.isBot(ua), ua).toBe(false);
  });

  it("attributes visits to channels from UTM tags first, then the referrer", () => {
    const c = classify.channelFor;
    expect(c({ source: "email", medium: "outreach", campaign: "x" }, undefined)).toBe("email");
    expect(c(undefined, "mail.google.com")).toBe("email");
    expect(c(undefined, "google.com")).toBe("google");
    expect(c(undefined, "google.no")).toBe("google");
    expect(c(undefined, "linkedin.com")).toBe("linkedin");
    expect(c(undefined, "lnkd.in")).toBe("linkedin");
    expect(c(undefined, "l.facebook.com")).toBe("facebook");
    expect(c(undefined, "bing.com")).toBe("search");
    expect(c(undefined, "t.co")).toBe("social");
    expect(c(undefined, "example.org")).toBe("referral");
    expect(c({ source: "partner-x", campaign: "spring" }, undefined)).toBe("campaign");
    expect(c(undefined, undefined)).toBe("direct");
  });

  it("keeps only origin + path of referrers and recognises internal navigation", () => {
    expect(classify.parseReferrer("https://www.google.com/search?q=private+stuff", HOST)).toEqual({ referrer: "https://www.google.com/search", referrerDomain: "google.com", internal: false });
    expect(classify.parseReferrer("https://www.exploretechify.com/services", HOST).internal).toBe(true);
    expect(classify.parseReferrer("javascript:alert(1)", HOST).internal).toBe(false);
  });

  it("parses public paths into language-neutral pages and Service Management slugs; rejects app paths", () => {
    expect(classify.parsePath("/no/services/seo?utm_source=email")).toMatchObject({ path: "/no/services/seo", page: "/services/seo", locale: "no", serviceSlug: "seo" });
    expect(classify.parsePath("/")).toMatchObject({ page: "/", locale: "en" });
    expect(classify.parsePath("/de")).toMatchObject({ page: "/", locale: "de" });
    for (const p of ["/dashboard/website-analytics", "/api/track", "/staff", "/portal/x", "//evil.example/x", "https://evil.example/", ""]) expect(classify.parsePath(p), p).toBeNull();
  });

  it("tags only our own links with the outreach campaign, never overwriting existing tags", () => {
    const utm = { source: "email", medium: "outreach", campaign: "outreach-general" };
    expect(classify.withCampaign("https://exploretechify.com/services/seo", HOST, utm)).toBe("https://exploretechify.com/services/seo?utm_source=email&utm_medium=outreach&utm_campaign=outreach-general");
    expect(classify.withCampaign("https://other.example/", HOST, utm)).toBe("https://other.example/");
    expect(classify.withCampaign("https://exploretechify.com/?utm_source=x", HOST, utm)).toBe("https://exploretechify.com/?utm_source=x");
  });

  it("never stores the raw cookie value: visitor ids are HMAC-hashed and labels are short codes", () => {
    const h = classify.hashVisitorId("abcdefghijklmnopqrstuvwx");
    expect(h).not.toContain("abcdefghijklmnopqrstuvwx");
    expect(classify.visitorLabel(h)).toMatch(/^[A-Z2-9]{4}$/);
  });
});

/* ───────────── Collection ───────────── */

describe("Collection", () => {
  it("without consent: records the page view with no visitor, session or cookie", async () => {
    const res = await trackRoute(post("/api/track", { url: "/services/seo?utm_source=google&utm_medium=cpc&utm_campaign=autumn", referrer: "https://www.google.com/" }), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").not.toContain(classify.VISITOR_COOKIE);
    const body = (await res.json()) as { id?: string };
    expect(body.id).toBeTruthy();
    const pv = await WebPageView.findById(body.id).lean<{ visitorId?: unknown }>();
    expect(pv).toMatchObject({ consented: false, entry: true, channel: "google", page: "/services/seo", serviceSlug: "seo" });
    expect(pv?.visitorId).toBeUndefined();
    expect(await WebVisitor.countDocuments()).toBe(0);
    expect(await WebSession.countDocuments()).toBe(0);
  });

  it("with consent: issues an httpOnly anonymous cookie and recognises the same browser next time", async () => {
    const first = await trackRoute(post("/api/track", { url: "/", referrer: "" }, "et_consent=granted"), ctx);
    const cookie = first.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/et_vid=[A-Za-z0-9_-]{22,};/);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie).toMatch(/Max-Age=34128000/);
    const vid = /et_vid=([^;]+)/.exec(cookie)![1]!;
    await trackRoute(post("/api/track", { url: "/services", referrer: `https://${HOST}/` }, `et_consent=granted; et_vid=${vid}`), ctx);
    expect(await WebVisitor.countDocuments()).toBe(1);
    const v = await WebVisitor.findOne().lean<WebVisitorDoc>();
    expect(v?.vidHash).toBe(classify.hashVisitorId(vid));
    expect(JSON.stringify(v)).not.toContain(vid);
    expect(v?.pageViews).toBe(2);
  });

  it("counts one visitor, one session and three page views for three pages in one visit", async () => {
    const b = await consentingBrowser();
    await b.view("/", at("2026-10-23T08:00:00Z"));
    await b.view("/services", at("2026-10-23T08:02:00Z"), { referrer: `https://${HOST}/` });
    await b.view("/contact", at("2026-10-23T08:05:00Z"), { referrer: `https://${HOST}/services` });
    expect(await WebVisitor.countDocuments()).toBe(1);
    expect(await WebSession.countDocuments()).toBe(1);
    expect(await WebPageView.countDocuments({ consented: true })).toBe(3);
    const s = await WebSession.findOne().lean<WebSessionDoc>();
    expect(s).toMatchObject({ sessionNo: 1, pageViews: 3, landingPage: "/", exitPage: "/contact" });
    expect(s!.lastSeen.getTime() - s!.startedAt.getTime()).toBe(5 * 60_000);
  });

  it("starts a new session after 30 minutes of inactivity — still one (returning) visitor", async () => {
    const b = await consentingBrowser();
    await b.view("/", at("2026-10-23T08:00:00Z"));
    await b.view("/services", at("2026-10-23T08:29:00Z"), { referrer: `https://${HOST}/` }); // within the timeout
    await b.view("/services", at("2026-10-23T09:00:00Z")); // 31 min idle
    expect(await WebSession.countDocuments()).toBe(2);
    expect(await WebVisitor.countDocuments()).toBe(1);
    expect((await WebSession.find().sort({ startedAt: 1 }).lean<WebSessionDoc[]>()).map((s) => s.sessionNo)).toEqual([1, 2]);
    expect(classify.SESSION_TIMEOUT_MS).toBe(30 * 60_000);
  });

  it("starts a new session when a new campaign arrives mid-visit", async () => {
    const b = await consentingBrowser();
    await b.view("/?utm_source=email&utm_medium=outreach&utm_campaign=a", at("2026-10-23T08:00:00Z"));
    await b.view("/?utm_source=linkedin&utm_campaign=b", at("2026-10-23T08:05:00Z"), { referrer: "https://www.linkedin.com/" });
    expect((await WebSession.find().sort({ startedAt: 1 }).lean<WebSessionDoc[]>()).map((s) => s.utm?.campaign)).toEqual(["a", "b"]);
  });

  it("captures UTM tags, referrer domain and landing page on the session", async () => {
    const b = await consentingBrowser();
    await b.view("/no/services/seo?utm_source=email&utm_medium=outreach&utm_campaign=outreach-has-website&utm_content=v1&utm_term=seo", at("2026-10-23T08:00:00Z"));
    const s = await WebSession.findOne().lean<WebSessionDoc>();
    expect(s).toMatchObject({ channel: "email", landingPage: "/services/seo", utm: { source: "email", medium: "outreach", campaign: "outreach-has-website", content: "v1", term: "seo" } });
    const b2 = await consentingBrowser();
    await b2.view("/", at("2026-10-23T08:00:00Z"), { referrer: "https://www.linkedin.com/feed/?trk=abc" });
    const s2 = await WebSession.findOne({ channel: "linkedin" }).lean<WebSessionDoc>();
    expect(s2).toMatchObject({ referrerDomain: "linkedin.com", referrer: "https://www.linkedin.com/feed/" });
  });

  it("ignores bots, automated browsers, the internal team and non-site paths", async () => {
    for (const ua of ["Mozilla/5.0 (compatible; Googlebot/2.1)", "curl/8.0"]) await trackRoute(post("/api/track", { url: "/" }, "et_consent=granted", ua), ctx);
    await trackRoute(post("/api/track", { url: "/", webdriver: true }, "et_consent=granted"), ctx);
    for (const user of [t.owner, t.admin, t.staff]) expect((await recordEvent({ url: "/" }, { userAgent: CHROME, host: HOST, consent: true, actor: user.actor })).reason).toBe("internal");
    expect((await recordEvent({ url: "/dashboard" }, { userAgent: CHROME, host: HOST, consent: false })).reason).toBe("path");
    expect(await WebPageView.countDocuments()).toBe(0);
  });

  it("associates a logged-in client account with the visit", async () => {
    const b = await consentingBrowser();
    await b.view("/portal-info", at("2026-10-23T08:00:00Z"), { actor: t.clientA.actor });
    const v = await WebVisitor.findOne().lean<WebVisitorDoc>();
    expect(String(v?.userId)).toBe(t.clientA.actor.id);
    expect(v?.userRole).toBe("CLIENT");
  });

  it("links earlier anonymous visits to a client who logs in (login only; never for internal roles)", async () => {
    const b = await consentingBrowser();
    await b.view("/", at("2026-10-23T08:00:00Z"));
    expect(await linkVisitorToUser(b.vid, { id: t.owner.actor.id, role: "OWNER" })).toBe(false);
    expect(await linkVisitorToUser(b.vid, { id: t.clientB.actor.id, role: "CLIENT" })).toBe(true);
    expect(String((await WebVisitor.findOne().lean<WebVisitorDoc>())?.userId)).toBe(t.clientB.actor.id);
    expect(await linkVisitorToUser("not a valid id", { id: t.clientB.actor.id, role: "CLIENT" })).toBe(false);
  });

  it("after 'Accept': replaces the page's cookieless record and keeps how the visit arrived", async () => {
    const landing = "/services/seo?utm_source=email&utm_medium=outreach&utm_campaign=outreach-general";
    const first = (await (await trackRoute(post("/api/track", { url: landing, referrer: "" }), ctx)).json()) as { id: string };
    await trackRoute(post("/api/track", { url: landing, referrer: "", replaces: first.id, landing: { url: landing, referrer: "" } }, "et_consent=granted"), ctx);
    expect(await WebPageView.countDocuments()).toBe(1);
    expect(await WebPageView.countDocuments({ consented: true })).toBe(1);
    expect(await WebSession.findOne().lean<WebSessionDoc>()).toMatchObject({ channel: "email", utm: { campaign: "outreach-general" }, landingPage: "/services/seo" });
  });

  it("pings keep the session's end time accurate without adding page views", async () => {
    const b = await consentingBrowser();
    await b.view("/", at("2026-10-23T08:00:00Z"));
    await recordEvent({ type: "ping", url: "/" }, { userAgent: CHROME, host: HOST, consent: true, vid: b.vid, now: at("2026-10-23T08:04:00Z") });
    const s = await WebSession.findOne().lean<WebSessionDoc>();
    expect(s!.lastSeen.toISOString()).toBe("2026-10-23T08:04:00.000Z");
    expect(s!.pageViews).toBe(1);
  });

  it("declining or withdrawing consent deletes the browser's data and cookie", async () => {
    const b = await consentingBrowser();
    await b.view("/", at("2026-10-23T08:00:00Z"));
    const res = await consentRoute(post("/api/track/consent", { granted: false }, `et_consent=denied; et_vid=${b.vid}`), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/et_vid=;/);
    expect(await WebVisitor.countDocuments()).toBe(0);
    expect(await WebSession.countDocuments()).toBe(0);
    expect(await WebPageView.countDocuments()).toBe(0);
    // A leftover cookie without consent is cleared and not used.
    const r2 = await trackRoute(post("/api/track", { url: "/" }, `et_vid=${b.vid}`), ctx);
    expect(r2.headers.get("set-cookie")).toMatch(/et_vid=;/);
    expect(await WebVisitor.countDocuments()).toBe(0);
  });
});

/* ───────────── Anonymous → known lead ───────────── */

describe("Enquiry linking", () => {
  const enquiry = { name: "Kari Nordmann", company: "Fjord AS", email: "kari@fjord.example", message: "We would like a new website.", service: "web-development" };

  it("links the browser's earlier visits to the enquiry it submits", async () => {
    const b = await consentingBrowser();
    await b.view("/", at("2026-10-23T08:00:00Z"));
    await b.view("/contact", new Date(), { referrer: `https://${HOST}/` });
    const res = await contactRoute(post("/api/contact", enquiry, `et_consent=granted; et_vid=${b.vid}`), ctx);
    expect(res.status).toBe(200);
    const v = await WebVisitor.findOne().lean<WebVisitorDoc>();
    expect(v?.contactRequestIds).toHaveLength(1);
    expect(v?.convertedAt).toBeTruthy();
    const detail = await svc.getVisitor(t.owner.actor, String(v!._id));
    expect(detail.status).toBe("Lead");
    expect(detail.enquiries[0]).toMatchObject({ name: "Kari Nordmann", company: "Fjord AS", email: "kari@fjord.example" });
    expect(detail.sessions.some((s) => s.enquiries === 1)).toBe(true);
  });

  it("never links without consent, and the enquiry is still saved", async () => {
    const b = await consentingBrowser();
    await b.view("/", at("2026-10-23T08:00:00Z"));
    const res = await contactRoute(post("/api/contact", enquiry, `et_vid=${b.vid}`), ctx);
    expect(res.status).toBe(200);
    expect(await ContactRequest.countDocuments()).toBe(1);
    expect((await WebVisitor.findOne().lean<WebVisitorDoc>())?.contactRequestIds).toHaveLength(0);
  });
});

/* ───────────── Aggregation & date filtering ───────────── */

describe("Aggregation", () => {
  async function seed() {
    // Visitor A: email campaign, two sessions on 20 Oct and one on 23 Oct (returning).
    const a = await consentingBrowser();
    await a.view("/services/seo?utm_source=email&utm_medium=outreach&utm_campaign=outreach-has-website", at("2026-10-20T08:00:00Z"));
    await a.view("/contact", at("2026-10-20T08:03:00Z"), { referrer: `https://${HOST}/services/seo` });
    await a.view("/services/seo", at("2026-10-23T10:00:00Z"), { referrer: "https://www.google.com/" });
    // Visitor B: new, from LinkedIn on 23 Oct.
    const b = await consentingBrowser();
    await b.view("/", at("2026-10-23T09:00:00Z"), { referrer: "https://www.linkedin.com/" });
    await b.view("/services/web-development", at("2026-10-23T09:01:00Z"), { referrer: `https://${HOST}/` });
    // One cookieless Google visit on 23 Oct, and one on 1 Oct (outside the ranges below).
    await recordEvent({ url: "/services/seo", referrer: "https://www.google.com/" }, { userAgent: CHROME, host: HOST, consent: false, now: at("2026-10-23T11:00:00Z") });
    await recordEvent({ url: "/", referrer: "" }, { userAgent: CHROME, host: HOST, consent: false, now: at("2026-10-01T11:00:00Z") });
    await ContactRequest.create({ name: "X", email: "x@example.test", message: "Hello there, a website please.", serviceSlug: "seo", createdAt: at("2026-10-23T10:05:00Z") });
    return { a, b };
  }

  it("computes the overview for a day: visits, unique/returning visitors, sessions, page views, duration, enquiries", async () => {
    await seed();
    const o = await svc.getOverview(t.owner.actor, range("2026-10-23"));
    expect(o).toMatchObject({ sessions: 2, cookielessVisits: 1, visits: 3, uniqueVisitors: 2, returningVisitors: 1, newVisitors: 1, pageViews: 4, enquiries: 1 });
    expect(o.avgSessionSeconds).toBe(30); // (60 s + 0 s) / 2
    expect(o.daily).toEqual([{ day: "2026-10-23", visits: 3, pageViews: 4 }]);
  });

  it("filters by date range in Norwegian time", async () => {
    await seed();
    const week = await svc.getOverview(t.owner.actor, range("2026-10-17", "2026-10-23"));
    expect(week).toMatchObject({ sessions: 3, uniqueVisitors: 2, pageViews: 6, cookielessVisits: 1 });
    expect(week.daily).toHaveLength(7);
    const early = await svc.getOverview(t.owner.actor, range("2026-10-01"));
    expect(early).toMatchObject({ sessions: 0, uniqueVisitors: 0, pageViews: 1, visits: 1 });
    // 23:30 UTC on 22 Oct is already 23 Oct in Oslo.
    const late = await consentingBrowser();
    await late.view("/about", at("2026-10-22T23:30:00Z"));
    expect((await svc.getOverview(t.owner.actor, range("2026-10-23"))).sessions).toBe(3);
    expect((await svc.getOverview(t.owner.actor, range("2026-10-22"))).sessions).toBe(0);
  });

  it("reports sources and campaigns with visitors, sessions, page views and enquiries", async () => {
    const { a } = await seed();
    await contactRoute(post("/api/contact", { name: "Ola Hansen", email: "ola@example.test", message: "Interested in SEO help." }, `et_consent=granted; et_vid=${a.vid}`), ctx);
    const r = range("2026-10-17", "2026-10-23");
    const sources = await svc.getSources(t.owner.actor, r);
    const by = Object.fromEntries(sources.map((s) => [s.key, s]));
    expect(by.email).toMatchObject({ label: "Email", visitors: 1, sessions: 1, pageViews: 2 });
    expect(by.linkedin).toMatchObject({ label: "LinkedIn", visitors: 1, sessions: 1, pageViews: 2 });
    expect(by.google).toMatchObject({ visitors: 1, sessions: 1, cookielessVisits: 1, pageViews: 2 });
    expect(sources.reduce((n, s) => n + s.enquiries, 0)).toBe(1);
    const campaigns = await svc.getCampaigns(t.owner.actor, r);
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0]).toMatchObject({ label: "outreach-has-website", source: "email", medium: "outreach", visitors: 1, sessions: 1 });
  });

  it("reports service pages by Service Management slug (no hard-coded names) and top pages", async () => {
    await Service.deleteMany({});
    await Service.create([
      { slug: "seo", name: "Search Visibility", active: true },
      { slug: "web-development", name: "Websites", active: true },
      { slug: "brand-new", name: "Renamed Or New Service", active: false },
    ]);
    await seed();
    const services = await svc.getServicePerformance(t.owner.actor, range("2026-10-17", "2026-10-23"));
    const seo = services.find((s) => s.slug === "seo")!;
    expect(seo).toMatchObject({ name: "Search Visibility", views: 3, visitors: 1, returningVisitors: 1, enquiries: 1 });
    expect(seo.landings).toBe(3);
    expect(services.find((s) => s.slug === "brand-new")).toMatchObject({ name: "Renamed Or New Service", views: 0, conversionRate: null });
    const pages = await svc.getPages(t.owner.actor, range("2026-10-17", "2026-10-23"));
    expect(pages[0]).toMatchObject({ page: "/services/seo", views: 3 });
  });

  it("lists visitors active in the range with status, and shows a visitor's timeline", async () => {
    await seed();
    const list = await svc.listVisitors(t.owner.actor, range("2026-10-23"));
    expect(list.total).toBe(2);
    expect(list.items.map((v) => v.status).sort()).toEqual(["New", "Returning"]);
    const returning = list.items.find((v) => v.status === "Returning")!;
    expect(returning).toMatchObject({ totalSessions: 2, sessionsInRange: 1, source: "Email" });
    const detail = await svc.getVisitor(t.owner.actor, returning.id);
    expect(detail.label).toMatch(/^[A-Z2-9]{4}$/);
    expect(detail.sessions.map((s) => s.pages.map((p) => p.path))).toEqual([["/services/seo"], ["/services/seo", "/contact"]]);
    await expectRejects(svc.getVisitor(t.owner.actor, String(new Types.ObjectId())), 404);
  });

  it("shows nothing invented when there is no data", async () => {
    const o = await svc.getOverview(t.owner.actor, range("2026-10-23"));
    expect(o).toMatchObject({ visits: 0, uniqueVisitors: 0, sessions: 0, pageViews: 0, avgSessionSeconds: 0 });
    expect(await svc.getSources(t.owner.actor, range("2026-10-23"))).toEqual([]);
    expect((await svc.listVisitors(t.owner.actor, range("2026-10-23"))).items).toEqual([]);
  });
});

/* ───────────── Access control ───────────── */

describe("Access: OWNER only", () => {
  it("the service refuses every other role", async () => {
    const r = range("2026-10-23");
    for (const user of [t.admin, t.staff, t.clientA]) {
      await expectRejects(svc.getOverview(user.actor, r), 403);
      await expectRejects(svc.listVisitors(user.actor, r), 403);
      await expectRejects(svc.getSources(user.actor, r), 403);
      await expectRejects(svc.getServicePerformance(user.actor, r), 403);
      await expectRejects(svc.exportAnalyticsCsv(user.actor, "visitors", r), 403);
    }
  });

  it("statistics, visitor detail and export APIs: Owner 200; Admin, Staff, Client 403; anonymous 401", async () => {
    const b = await consentingBrowser();
    await b.view("/", new Date());
    const vId = String((await WebVisitor.findOne().lean<WebVisitorDoc>())!._id);
    const calls = [
      () => statsRoute(req("/api/website-analytics?view=overview"), ctx),
      () => statsRoute(req("/api/website-analytics?view=visitors"), ctx),
      () => exportRoute(req("/api/website-analytics/export?kind=sessions"), ctx),
      () => visitorRoute(req(`/api/website-analytics/visitors/${vId}`), { params: Promise.resolve({ id: vId }) }),
    ];
    for (const call of calls) {
      as(t.owner);
      expect((await call()).status).toBe(200);
      for (const user of [t.admin, t.staff, t.clientA]) {
        as(user);
        expect((await call()).status).toBe(403);
      }
      as(null);
      expect((await call()).status).toBe(401);
    }
  });

  it("the public beacon never returns analytics data", async () => {
    const b = await consentingBrowser();
    await b.view("/", new Date());
    const res = await trackRoute(post("/api/track", { url: "/services" }, "et_consent=granted"), ctx);
    expect(Object.keys((await res.json()) as object)).toEqual(["ok"]);
  });

  it("CSV exports carry no IP addresses, names or emails, and are formula-safe", async () => {
    const b = await consentingBrowser();
    await b.view("/?utm_source=x&utm_campaign=%3Dcmd%7Ccalc", new Date());
    await contactRoute(post("/api/contact", { name: "Kari Nordmann", email: "kari@fjord.example", message: "We would like a new website." }, `et_consent=granted; et_vid=${b.vid}`), ctx);
    as(t.owner);
    for (const kind of svc.EXPORT_KINDS) {
      const res = await exportRoute(req(`/api/website-analytics/export?kind=${kind}`), ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/csv");
      const csv = await res.text();
      expect(csv).not.toMatch(/kari|Nordmann|@|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/i);
    }
    // A hostile campaign name from a URL is neutralised for spreadsheets.
    expect(await (await exportRoute(req("/api/website-analytics/export?kind=sessions"), ctx)).text()).toContain(`"'=cmd|calc"`);
    expect((await exportRoute(req("/api/website-analytics/export?kind=everything"), ctx)).status).toBe(400);
  });

  it("the dashboard path is a hard 404 for signed-in non-owners in the proxy", async () => {
    const { proxy } = await import("@/proxy");
    const { signSession, SESSION_COOKIE } = await import("@/lib/auth/token");
    for (const role of ["ADMIN", "STAFF", "CLIENT"] as const) {
      const token = await signSession({ sub: String(new Types.ObjectId()), role, sv: 0 });
      const r = await proxy(req("/dashboard/website-analytics/visitors/abc", { headers: { cookie: `${SESSION_COOKIE}=${token}` } }));
      expect(r.status).toBe(404);
    }
    const ownerToken = await signSession({ sub: String(new Types.ObjectId()), role: "OWNER", sv: 0 });
    expect((await proxy(req("/dashboard/website-analytics", { headers: { cookie: `${SESSION_COOKIE}=${ownerToken}` } }))).status).toBe(200);
  });
});

/* ───────────── Location & visit time ───────────── */

describe("Location and local time", () => {
  const NO = { "x-vercel-ip-country": "NO", "x-vercel-ip-country-region": "Oslo", "x-vercel-ip-city": "Oslo" };
  const geoPost = (body: unknown, cookie: string, headers: Record<string, string>) =>
    req("/api/track", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "user-agent": CHROME, host: HOST, ...(cookie && { cookie }), ...headers } });

  it("reads coarse location from hosting headers and ignores private addresses", async () => {
    expect(geo.geoFromHeaders(new Headers(NO))).toEqual({ country: "NO", region: "Oslo", city: "Oslo" });
    expect(geo.geoFromHeaders(new Headers({ "cf-ipcountry": "se", "cf-ipcity": "G%C3%B6teborg" }))).toEqual({ country: "SE", region: undefined, city: "Göteborg" });
    expect(geo.geoFromHeaders(new Headers({ "cf-ipcountry": "XX" }))).toBeNull();
    for (const ip of ["192.168.1.5", "10.0.0.1", "127.0.0.1", "::1", "local", ""]) expect(await geo.lookupGeo(new Headers(), ip), ip).toBeNull();
    expect(geo.validTimeZone("Europe/Oslo")).toBe("Europe/Oslo");
    expect(geo.validTimeZone("America/Argentina/Buenos_Aires")).toBe("America/Argentina/Buenos_Aires");
    for (const tz of ["Not/AZone", "<script>", "x".repeat(80), 42]) expect(geo.validTimeZone(tz)).toBeUndefined();
  });

  it("stores country, region, city and time zone on the visit — never the IP address", async () => {
    const ip = "84.208.20.110";
    const res = await trackRoute(geoPost({ url: "/services", tz: "Europe/Oslo" }, "et_consent=granted", { ...NO, "x-forwarded-for": ip }), ctx);
    expect(res.status).toBe(200);
    const s = await WebSession.findOne().lean<WebSessionDoc>();
    expect(s).toMatchObject({ geo: { country: "NO", region: "Oslo", city: "Oslo" }, timeZone: "Europe/Oslo" });
    expect((await WebVisitor.findOne().lean<WebVisitorDoc>())?.geo).toMatchObject({ country: "NO", city: "Oslo" });
    // Without consent the page view still carries the coarse location (and nothing identifying).
    await trackRoute(geoPost({ url: "/", referrer: "https://www.google.com/", tz: "America/New_York" }, "", { "x-vercel-ip-country": "US", "x-vercel-ip-city": "New%20York", "x-forwarded-for": "8.8.8.8" }), ctx);
    const anon = await WebPageView.findOne({ consented: false }).lean<{ geo?: unknown; timeZone?: string; visitorId?: unknown }>();
    expect(anon).toMatchObject({ geo: { country: "US", city: "New York" }, timeZone: "America/New_York" });
    expect(anon?.visitorId).toBeUndefined();
    for (const model of [WebVisitor, WebSession, WebPageView] as const) {
      const all = JSON.stringify(await (model as typeof WebPageView).find().lean());
      expect(all).not.toContain(ip);
      expect(all).not.toContain("8.8.8.8");
    }
  });

  it("only looks up a location for page views that are recorded", async () => {
    const lookups: string[] = [];
    const resolveGeo = async () => (lookups.push("x"), { country: "NO" });
    await recordEvent({ url: "/" }, { userAgent: "curl/8.0", host: HOST, consent: true, resolveGeo });
    await recordEvent({ url: "/" }, { userAgent: CHROME, host: HOST, consent: true, actor: t.owner.actor, resolveGeo });
    await recordEvent({ type: "ping", url: "/" }, { userAgent: CHROME, host: HOST, consent: true, vid: "abcdefghijklmnopqrstuvwx", resolveGeo });
    expect(lookups).toHaveLength(0);
    await recordEvent({ url: "/" }, { userAgent: CHROME, host: HOST, consent: false, resolveGeo });
    expect(lookups).toHaveLength(1);
    // A failing lookup never blocks the visit.
    const r = await recordEvent({ url: "/about" }, { userAgent: CHROME, host: HOST, consent: false, resolveGeo: async () => Promise.reject(new Error("db")) });
    expect(r.recorded).toBe(true);
  });

  it("reports countries, areas and the latest visits with their time and location", async () => {
    const day = (h: number) => at(`2026-10-23T${String(h).padStart(2, "0")}:00:00Z`);
    // A visitor from Oslo (two pages), one from Bergen, one without consent from New York, and one with no known location.
    const oslo = await recordEvent({ url: "/", tz: "Europe/Oslo" }, { userAgent: CHROME, host: HOST, consent: true, now: day(8), resolveGeo: async () => ({ country: "NO", region: "Oslo", city: "Oslo" }) });
    await recordEvent({ url: "/services", referrer: `https://${HOST}/` }, { userAgent: CHROME, host: HOST, consent: true, vid: oslo.newVid, now: at("2026-10-23T08:05:00Z"), resolveGeo: async () => ({ country: "NO", region: "Oslo", city: "Oslo" }) });
    await recordEvent({ url: "/about" }, { userAgent: CHROME, host: HOST, consent: true, now: at("2026-10-23T07:00:00Z") });
    const bergen = await recordEvent({ url: "/", tz: "Europe/Oslo" }, { userAgent: CHROME, host: HOST, consent: true, now: day(9), resolveGeo: async () => ({ country: "NO", region: "Vestland", city: "Bergen" }) });
    expect(bergen.newVid).toBeTruthy();
    await recordEvent({ url: "/", referrer: "https://www.google.com/", tz: "America/New_York" }, { userAgent: CHROME, host: HOST, consent: false, now: day(10), resolveGeo: async () => ({ country: "US", region: "New York", city: "New York" }) });

    const { countries, areas } = await svc.getLocations(t.owner.actor, range("2026-10-23"));
    expect(countries.map((c) => c.country)).toEqual(["NO", "US", undefined]);
    expect(countries[0]).toMatchObject({ country: "NO", visitors: 2, sessions: 2 });
    expect(countries[1]).toMatchObject({ country: "US", visitors: 0, sessions: 0, cookielessVisits: 1 });
    expect(areas.map((a) => a.city)).toEqual(expect.arrayContaining(["Oslo", "Bergen", "New York"]));

    const recent = await svc.getRecentVisits(t.owner.actor, range("2026-10-23"));
    expect(recent.map((v) => [v.at.toISOString(), v.kind, v.geo?.city ?? null])).toEqual([
      ["2026-10-23T10:00:00.000Z", "anonymous", "New York"],
      ["2026-10-23T09:00:00.000Z", "tracked", "Bergen"],
      ["2026-10-23T08:00:00.000Z", "tracked", "Oslo"],
      ["2026-10-23T07:00:00.000Z", "tracked", null],
    ]);
    expect(recent[2]).toMatchObject({ pageViews: 2, durationSeconds: 300 });
    expect(recent[0]).toMatchObject({ timeZone: "America/New_York", landingPage: "/", channel: "Google" });
    expect(recent[1]!.label).toMatch(/^[A-Z2-9]{4}$/);

    const visitors = await svc.listVisitors(t.owner.actor, range("2026-10-23"));
    expect(visitors.items.map((v) => v.geo?.city)).toEqual(expect.arrayContaining(["Oslo", "Bergen"]));

    as(t.owner);
    const csv = await (await exportRoute(req("/api/website-analytics/export?kind=locations&range=custom&from=2026-10-23&to=2026-10-23"), ctx)).text();
    expect(csv).toContain('"country","region","city"');
    expect(csv).toContain('"NO","Vestland","Bergen"');
    const sessionsCsv = await (await exportRoute(req("/api/website-analytics/export?kind=sessions&range=custom&from=2026-10-23&to=2026-10-23"), ctx)).text();
    expect(sessionsCsv).toContain('"Oslo","Europe/Oslo"');
  });

  it("location data is Owner-only like the rest of analytics", async () => {
    for (const user of [t.admin, t.staff, t.clientA]) {
      await expectRejects(svc.getLocations(user.actor, range("2026-10-23")), 403);
      await expectRejects(svc.getRecentVisits(user.actor, range("2026-10-23")), 403);
      as(user);
      expect((await statsRoute(req("/api/website-analytics?view=locations"), ctx)).status).toBe(403);
      expect((await statsRoute(req("/api/website-analytics?view=recent"), ctx)).status).toBe(403);
    }
    as(null);
    expect((await statsRoute(req("/api/website-analytics?view=locations"), ctx)).status).toBe(401);
    as(t.owner);
    expect((await statsRoute(req("/api/website-analytics?view=locations"), ctx)).status).toBe(200);
  });
});

/* ───────────── Failure isolation ───────────── */

describe("Analytics failures never break the website", () => {
  it("the beacon answers 200 even when recording fails", async () => {
    const spy = vi.spyOn(WebPageView, "create").mockRejectedValueOnce(new Error("database down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await trackRoute(post("/api/track", { url: "/" }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false });
    spy.mockRestore();
    errors.mockRestore();
  });

  it("invalid beacons are ignored quietly", async () => {
    for (const body of [{}, { url: 42 }, { url: "x".repeat(5000) }]) expect((await trackRoute(post("/api/track", body), ctx)).status).toBe(200);
    expect(await WebPageView.countDocuments()).toBe(0);
  });

  it("an enquiry is saved even when linking it to analytics fails", async () => {
    const b = await consentingBrowser();
    await b.view("/", new Date());
    const spy = vi.spyOn(WebVisitor, "updateOne").mockRejectedValueOnce(new Error("database down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await contactRoute(post("/api/contact", { name: "Kari Nordmann", email: "kari@fjord.example", message: "We would like a new website." }, `et_consent=granted; et_vid=${b.vid}`), ctx);
    expect(res.status).toBe(200);
    expect(await ContactRequest.countDocuments()).toBe(1);
    spy.mockRestore();
    errors.mockRestore();
  });
});
