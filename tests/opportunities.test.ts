import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { Company, Opportunity, OpportunityFeed, OpportunitySyncRun, User, type OpportunityDoc, type OpportunityFeedDoc, type OpportunitySyncRunDoc, type UserDoc } from "@/models";
import type { SessionUser } from "@/lib/auth/actor";
import { toActor } from "@/lib/auth/actor";
import { PERMISSIONS, type Actor } from "@/lib/permissions";
import { detectCountry } from "@/config/opportunity-countries";
import { canonicalUrlKey, parseDeadline, parseSourceDate, serviceCategoriesFromCpv } from "@/features/opportunities/normalize";
import { computeActivity, deriveContactRoutes, deriveLabels, looksLikeAgency, reviewReasons } from "@/features/opportunities/verification";
import { ingestItems, markRemoved } from "@/features/opportunities/ingest";
import { OPPORTUNITY_PROVIDERS } from "@/features/opportunities/providers";
import type { FetchResult, NormalizedOpportunity, OpportunityProvider } from "@/features/opportunities/providers/types";
import { normalizeTedNotice } from "@/features/opportunities/providers/ted";
import { expectRejects, makeTenants, makeUser } from "./helpers";

/**
 * Verified Opportunity Intelligence tests. All records here are ISOLATED TEST FIXTURES
 * created inside this throw-away in-memory database — never production data.
 */
const session = vi.hoisted(() => ({ current: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => session.current,
  getActor: async () => session.current?.actor ?? null,
}));

const service = await import("@/features/opportunities/service");
const sync = await import("@/features/opportunities/sync");
const { GET: listRoute } = await import("@/app/api/opportunities/route");
const { GET: detailRoute, PATCH: patchRoute } = await import("@/app/api/opportunities/[id]/route");
const { GET: feedsRoute, POST: createFeedRoute } = await import("@/app/api/opportunities/feeds/route");
const { GET: exportRoute } = await import("@/app/api/opportunities/export/route");
const { GET: coverageRoute } = await import("@/app/api/opportunities/coverage/route");
const { GET: statsRoute } = await import("@/app/api/opportunities/stats/route");
const { POST: bulkRoute } = await import("@/app/api/opportunities/bulk/route");
const { POST: syncRoute } = await import("@/app/api/opportunities/feeds/[id]/sync/route");

let t: Awaited<ReturnType<typeof makeTenants>>;
let adminAll: Awaited<ReturnType<typeof makeUser>>;

function as(user: { actor: Actor } | null) {
  session.current = user ? { id: user.actor.id, name: user.actor.name, email: user.actor.email, role: user.actor.role, status: "ACTIVE", organizationId: user.actor.organizationId, organizationStatus: "ACTIVE", actor: user.actor } : null;
}
const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(new URL(url, "http://localhost:3000"), init);
const ctx = <P extends object>(params: P = {} as P) => ({ params: Promise.resolve(params) });

/* ───────── Isolated test provider (fixture) ───────── */

type Script = { items?: NormalizedOpportunity[]; removedIds?: string[]; fullListing?: boolean; throws?: string };
function makeTestProvider(id: string, overrides: Partial<OpportunityProvider> = {}) {
  const script: { next: Script } = { next: {} };
  const provider: OpportunityProvider = {
    id,
    name: `Test provider ${id}`,
    publisher: "Test fixture",
    type: "HIRING",
    defaultSourceClass: "OFFICIAL_PUBLIC_EMPLOYMENT_SERVICE",
    perEmployer: false,
    coverage: [{ code: "SE", level: "NATIONAL_OFFICIAL", note: "test" }],
    access: { type: "OPEN", requiredEnv: [], termsNote: "test" },
    docsUrl: "https://example.test",
    homepage: "https://example.test",
    description: "test",
    limitations: "test",
    capabilities: { incremental: true, pagination: false, publishedAt: true, updatedAt: false, deadline: true, removalDetection: "LISTING_DIFF", activityCheck: false, employerIdentity: "REGISTRATION_NUMBER", contacts: true, webhooks: false, directApplyLink: true },
    evidence: "REAL_DATA_TESTED",
    freshnessNote: "test",
    recommendedIntervalMinutes: 60,
    isConfigured: () => ({ ok: true, missing: [] }),
    async fetch(): Promise<FetchResult> {
      const s = script.next;
      if (s.throws) throw new Error(s.throws);
      return { items: s.items ?? [], removedIds: s.removedIds, complete: true, fullListing: s.fullListing ?? false, cursor: "c1" };
    },
    ...overrides,
  };
  OPPORTUNITY_PROVIDERS.push(provider);
  return { provider, script };
}

function item(over: Partial<NormalizedOpportunity> & { externalId: string }): NormalizedOpportunity {
  return {
    type: "HIRING",
    title: "Backend developer",
    organization: { name: "Testbolaget AB", registrationNumber: "5560000001", registrationCountry: "SE" },
    countryCode: "SE",
    sourceUrl: `https://jobs.example.test/${over.externalId}`,
    sourceClass: "OFFICIAL_PUBLIC_EMPLOYMENT_SERVICE",
    sourcePublisher: "Test fixture",
    ...over,
  };
}

async function feedFor(provider: OpportunityProvider) {
  return OpportunityFeed.findOneAndUpdate({ key: provider.id }, { $setOnInsert: { key: provider.id, providerId: provider.id, kind: "PROVIDER", enabled: true, settings: {}, config: {} } }, { upsert: true, new: true }).lean<{ _id: Types.ObjectId; key: string }>();
}

beforeAll(async () => {
  t = await makeTenants();
  // An ADMIN holding EVERY permission must still be refused — owner access is role-based, not permission-based.
  adminAll = await makeUser("ADMIN", { permissions: [...PERMISSIONS] });
});

/* ───────────────────────── Authorization ───────────────────────── */

describe("Owner-only authorization (service layer)", () => {
  const calls: [string, (a: Actor | null) => Promise<unknown>][] = [
    ["listOpportunities", (a) => service.listOpportunities(a, {})],
    ["getOpportunityStats", (a) => service.getOpportunityStats(a)],
    ["getOpportunityDetail", (a) => service.getOpportunityDetail(a, String(new Types.ObjectId()))],
    ["updateOpportunity", (a) => service.updateOpportunity(a, String(new Types.ObjectId()), { saved: true })],
    ["addOpportunityNote", (a) => service.addOpportunityNote(a, String(new Types.ObjectId()), { text: "x" })],
    ["verifyOpportunityManually", (a) => service.verifyOpportunityManually(a, String(new Types.ObjectId()), { result: "CONFIRMED_GENUINE" })],
    ["recheckOpportunity", (a) => service.recheckOpportunity(a, String(new Types.ObjectId()))],
    ["addOpportunityToCrm", (a) => service.addOpportunityToCrm(a, String(new Types.ObjectId()))],
    ["bulkUpdateOpportunities", (a) => service.bulkUpdateOpportunities(a, { ids: [String(new Types.ObjectId())], action: "save" })],
    ["exportOpportunitiesCsv", (a) => service.exportOpportunitiesCsv(a, {})],
    ["listFeeds", (a) => service.listFeeds(a)],
    ["createEmployerFeed", (a) => service.createEmployerFeed(a, { providerId: "greenhouse", config: {} })],
    ["updateFeed", (a) => service.updateFeed(a, String(new Types.ObjectId()), { enabled: true })],
    ["deleteEmployerFeed", (a) => service.deleteEmployerFeed(a, String(new Types.ObjectId()))],
    ["triggerFeedSync", (a) => service.triggerFeedSync(a, String(new Types.ObjectId()))],
    ["reverifyFeed", (a) => service.reverifyFeed(a, String(new Types.ObjectId()))],
    ["listSyncRuns", (a) => service.listSyncRuns(a)],
    ["getCountryCoverage", (a) => service.getCountryCoverage(a)],
    ["opportunityNavCounts", (a) => service.opportunityNavCounts(a)],
    ["searchCompaniesForLink", (a) => service.searchCompaniesForLink(a, "Test")],
  ];

  it.each(calls)("%s: 401 without a user, 403 for ADMIN / STAFF / CLIENT", async (_name, call) => {
    await expectRejects(call(null), 401);
    await expectRejects(call(t.admin.actor), 403);
    await expectRejects(call(adminAll.actor), 403);
    await expectRejects(call(t.staff.actor), 403);
    await expectRejects(call(t.clientA.actor), 403);
  });

  it("a client-supplied role is never trusted: the role comes from the stored account", async () => {
    // Forged actor object claiming OWNER for an ADMIN account id: services re-check the actor role,
    // and routes always build the actor from the database (see route tests below).
    const forged = toActor((await User.findById(t.admin.user._id).lean<UserDoc>())!);
    expect(forged.role).toBe("ADMIN");
    await expectRejects(service.listOpportunities(forged, {}), 403);
  });

  it("OWNER can use the module", async () => {
    await expect(service.listOpportunities(t.owner.actor, {})).resolves.toMatchObject({ total: expect.any(Number) });
    await expect(service.listFeeds(t.owner.actor)).resolves.toMatchObject({ feeds: expect.any(Array) });
  });
});

describe("Owner-only authorization (API routes)", () => {
  const routes: [string, () => Promise<Response>][] = [
    ["GET /api/opportunities", () => listRoute(req("/api/opportunities"), ctx())],
    ["GET /api/opportunities/[id]", () => detailRoute(req(`/api/opportunities/${new Types.ObjectId()}`), ctx({ id: String(new Types.ObjectId()) }))],
    ["PATCH /api/opportunities/[id]", () => patchRoute(req(`/api/opportunities/x`, { method: "PATCH", body: JSON.stringify({ saved: true }) }), ctx({ id: String(new Types.ObjectId()) }))],
    ["GET /api/opportunities/feeds", () => feedsRoute(req("/api/opportunities/feeds"), ctx())],
    ["POST /api/opportunities/feeds", () => createFeedRoute(req("/api/opportunities/feeds", { method: "POST", body: JSON.stringify({ providerId: "greenhouse", config: {} }) }), ctx())],
    ["GET /api/opportunities/export", () => exportRoute(req("/api/opportunities/export"), ctx())],
    ["GET /api/opportunities/coverage", () => coverageRoute(req("/api/opportunities/coverage"), ctx())],
    ["GET /api/opportunities/stats", () => statsRoute(req("/api/opportunities/stats"), ctx())],
    ["POST /api/opportunities/bulk", () => bulkRoute(req("/api/opportunities/bulk", { method: "POST", body: JSON.stringify({ ids: [String(new Types.ObjectId())], action: "save" }) }), ctx())],
    ["POST /api/opportunities/feeds/[id]/sync", () => syncRoute(req("/api/opportunities/feeds/x/sync", { method: "POST" }), ctx({ id: String(new Types.ObjectId()) }))],
  ];

  it.each(routes)("%s → 401 unauthenticated, 403 for every non-owner role", async (_n, call) => {
    as(null);
    expect((await call()).status).toBe(401);
    for (const u of [t.admin, adminAll, t.staff, t.clientA]) {
      as(u);
      const res = await call();
      expect(res.status).toBe(403);
      // No private record content in the error body.
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("FORBIDDEN");
    }
  });

  it("the owner gets data; non-owners never see opportunity content", async () => {
    await Opportunity.create({ type: "PROCUREMENT", providerId: "route-test", externalId: "r1", title: "Secret tender", sourceClass: "OFFICIAL_PROCUREMENT_PORTAL", countryCode: "FR", activity: "ACTIVE" });
    as(t.owner);
    const ok = await listRoute(req("/api/opportunities?activity=all"), ctx());
    expect(ok.status).toBe(200);
    expect(JSON.stringify(await ok.json())).toContain("Secret tender");
    as(t.admin);
    const denied = await listRoute(req("/api/opportunities?activity=all"), ctx());
    expect(JSON.stringify(await denied.json())).not.toContain("Secret tender");
    as(t.owner);
    const csv = await exportRoute(req("/api/opportunities/export?activity=all"), ctx());
    expect(csv.status).toBe(200);
    expect(await csv.text()).toContain("Secret tender");
  });

  it("the module is excluded from public indexing and gated by the proxy", async () => {
    const { default: robots } = await import("@/app/robots");
    const rules = robots().rules as { disallow: string[] }[];
    expect(rules[0]!.disallow).toEqual(expect.arrayContaining(["/api/", "/dashboard"]));
    const { proxy } = await import("@/proxy");
    const res = await proxy(req("/dashboard/opportunities"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    // Signed-in non-owners get a hard 404 from the proxy before anything renders.
    const { signSession, SESSION_COOKIE } = await import("@/lib/auth/token");
    for (const role of ["ADMIN", "STAFF"] as const) {
      const token = await signSession({ sub: String(new Types.ObjectId()), role, sv: 0 });
      const r = await proxy(req("/dashboard/opportunities/hiring", { headers: { cookie: `${SESSION_COOKIE}=${token}` } }));
      expect(r.status).toBe(404);
      expect(await r.text()).toBe("Not found");
    }
    const ownerToken = await signSession({ sub: String(new Types.ObjectId()), role: "OWNER", sv: 0 });
    expect((await proxy(req("/dashboard/opportunities", { headers: { cookie: `${SESSION_COOKIE}=${ownerToken}` } }))).status).toBe(200);
  });
});

/* ───────────────────────── Ingestion & dedupe ───────────────────────── */

describe("Ingestion", () => {
  it("is idempotent: repeated imports never create duplicates", async () => {
    const { provider } = makeTestProvider("idem");
    const feed = await feedFor(provider);
    const items = [item({ externalId: "a1" }), item({ externalId: "a2", title: "Frontend developer" })];
    const first = await ingestItems(items, { provider, feed: { ...feed!, config: {}, settings: {} } as never });
    const second = await ingestItems(items, { provider, feed: { ...feed!, config: {}, settings: {} } as never });
    expect(first.created).toBe(2);
    expect(second.created).toBe(0);
    expect(second.unchanged).toBe(2);
    expect(await Opportunity.countDocuments({ providerId: "idem" })).toBe(2);
  });

  it("missing source dates stay missing (never filled with import time)", async () => {
    const { provider } = makeTestProvider("dates");
    const feed = await feedFor(provider);
    await ingestItems([item({ externalId: "d1", publishedAt: undefined, deadline: undefined })], { provider, feed: { ...feed!, config: {}, settings: {} } as never });
    const d = await Opportunity.findOne({ providerId: "dates", externalId: "d1" }).lean<OpportunityDoc>();
    expect(d?.publishedAt ?? null).toBeNull();
    expect(d?.deadline ?? null).toBeNull();
    expect(d?.firstSeenAt).toBeInstanceOf(Date);
  });

  it("groups the same opportunity across providers by canonical URL and keeps both source records", async () => {
    const a = makeTestProvider("dup-a");
    const b = makeTestProvider("dup-b");
    const fa = await feedFor(a.provider);
    const fb = await feedFor(b.provider);
    const apply = "https://boards.greenhouse.io/acme/jobs/123?gh_src=abc";
    await ingestItems([item({ externalId: "x", applyUrl: apply, sourceClass: "OFFICIAL_PUBLIC_EMPLOYMENT_SERVICE" })], { provider: a.provider, feed: { ...fa!, config: {}, settings: {} } as never });
    const res = await ingestItems([item({ externalId: "y", applyUrl: "https://boards.greenhouse.io/acme/jobs/123", sourceClass: "OFFICIAL_EMPLOYER_ATS" })], { provider: b.provider, feed: { ...fb!, config: {}, settings: {} } as never });
    expect(res.duplicatesLinked).toBe(1);
    const docs = await Opportunity.find({ providerId: { $in: ["dup-a", "dup-b"] } }).lean<OpportunityDoc[]>();
    expect(docs).toHaveLength(2);
    expect(new Set(docs.map((d) => d.dupGroup)).size).toBe(1);
    // The employer ATS record is the more authoritative source → canonical.
    expect(docs.find((d) => d.isCanonical)?.providerId).toBe("dup-b");
    const list = await service.listOpportunities(t.owner.actor, { q: undefined, provider: undefined, company: "Testbolaget", activity: "all" });
    expect(list.items.filter((i) => i.dupGroup === docs[0]!.dupGroup)).toHaveLength(1);
  });

  it("never folds two postings with the same title from one provider (strict fallback)", async () => {
    const a = makeTestProvider("fb-a");
    const b = makeTestProvider("fb-b");
    const fa = await feedFor(a.provider);
    const fb = await feedFor(b.provider);
    const base = { title: "Account manager", organization: { name: "Samma AB", registrationNumber: "5569999999", registrationCountry: "SE" } };
    await ingestItems([item({ externalId: "1", ...base }), item({ externalId: "2", ...base })], { provider: a.provider, feed: { ...fa!, config: {}, settings: {} } as never });
    const r = await ingestItems([item({ externalId: "3", ...base })], { provider: b.provider, feed: { ...fb!, config: {}, settings: {} } as never });
    expect(r.duplicatesLinked).toBe(0);
    expect(await Opportunity.countDocuments({ providerId: { $in: ["fb-a", "fb-b"] }, isCanonical: true })).toBe(3);
  });

  it("links companies by registration number, never by a similar name", async () => {
    await Company.create({ companyName: "Länkbolaget AB", registrationNumber: "556123-4567", countryCode: "SE", source: "t", sourceId: "link-1" });
    await Company.create({ companyName: "Namnlikt AB", countryCode: "SE", source: "t", sourceId: "link-2" });
    const { provider } = makeTestProvider("link");
    const feed = await feedFor(provider);
    await ingestItems(
      [item({ externalId: "l1", organization: { name: "Länkbolaget AB", registrationNumber: "5561234567", registrationCountry: "SE" } }), item({ externalId: "l2", organization: { name: "Namnlikt AB" } })],
      { provider, feed: { ...feed!, config: {}, settings: {} } as never },
    );
    const l1 = await Opportunity.findOne({ providerId: "link", externalId: "l1" }).lean<OpportunityDoc>();
    const l2 = await Opportunity.findOne({ providerId: "link", externalId: "l2" }).lean<OpportunityDoc>();
    expect(l1?.companyLink?.method).toBe("REGISTRATION_NUMBER");
    expect(l1?.employerIdentity).toBe("CONFIRMED");
    expect(l2?.companyLink?.companyId).toBeUndefined();
    expect(l2?.employerIdentity).toBe("NOT_CONFIRMED");
  });

  it("an agency's own registry match does not confirm the hiring employer", async () => {
    await Company.create({ companyName: "Norrland Rekrytering AB", registrationNumber: "5560001111", countryCode: "SE", source: "t", sourceId: "agency-1" });
    const { provider } = makeTestProvider("agency");
    const feed = await feedFor(provider);
    await ingestItems([item({ externalId: "ag1", organization: { name: "Norrland Rekrytering AB", registrationNumber: "5560001111", registrationCountry: "SE" } })], { provider, feed: { ...feed!, config: {}, settings: {} } as never });
    const d = await Opportunity.findOne({ providerId: "agency" }).lean<OpportunityDoc>();
    expect(d?.employerIdentity).not.toBe("CONFIRMED");
    expect(d?.labels).toContain("NEEDS_MANUAL_REVIEW");
  });
});

/* ───────────────────────── Sync, failures, removal ───────────────────────── */

describe("Synchronization and status", () => {
  it("a failed provider run is reported and never closes or deletes existing records", async () => {
    const { provider, script } = makeTestProvider("fail");
    const feed = await feedFor(provider);
    script.next = { items: [item({ externalId: "f1" })] };
    expect((await sync.runFeed(feed!._id, "MANUAL")).status).toBe("SUCCESS");
    script.next = { throws: "Upstream responded 503" };
    const r = await sync.runFeed(feed!._id, "MANUAL");
    expect(r.status).toBe("FAILED");
    const run = await OpportunitySyncRun.findOne({ feedId: feed!._id, status: "FAILED" }).lean<OpportunitySyncRunDoc>();
    expect(run?.errorLog.join(" ")).toContain("503");
    const doc = await Opportunity.findOne({ providerId: "fail", externalId: "f1" }).lean<OpportunityDoc>();
    expect(doc?.sourceState).toBe("LISTED");
    expect(doc?.activity).toBe("ACTIVE");
    const f = await OpportunityFeed.findById(feed!._id).lean<OpportunityFeedDoc>();
    expect(f?.health?.consecutiveFailures).toBe(1);
    expect(f?.health?.lastError).toContain("503");
  });

  it("missing credentials produce a truthful configuration state, not a fake success", async () => {
    delete process.env.NAV_JOB_FEED_TOKEN;
    await sync.ensureProviderFeeds();
    const nav = await OpportunityFeed.findOne({ key: "nav-no" }).lean<OpportunityFeedDoc>();
    expect(nav?.enabled).toBe(false);
    await OpportunityFeed.updateOne({ key: "nav-no" }, { $set: { enabled: true } });
    const r = await sync.runFeed(nav!._id, "MANUAL");
    expect(r.status).toBe("SKIPPED");
    expect(await OpportunitySyncRun.countDocuments({ feedId: nav!._id })).toBe(0);
    const { feeds } = await service.listFeeds(t.owner.actor);
    expect(feeds.find((f) => f.key === "nav-no")?.state).toBe("NEEDS_CREDENTIALS");
    expect(feeds.find((f) => f.key === "adzuna")?.state).toBe("NEEDS_CREDENTIALS");
    expect(await Opportunity.countDocuments({ providerId: "nav-no" })).toBe(0);
  });

  it("listing diff: one absence does not remove; two complete absences do", async () => {
    const { provider, script } = makeTestProvider("diff");
    const feed = await feedFor(provider);
    script.next = { items: [item({ externalId: "k1" }), item({ externalId: "k2", title: "Designer" })], fullListing: true };
    await sync.runFeed(feed!._id);
    script.next = { items: [item({ externalId: "k1" })], fullListing: true };
    await sync.runFeed(feed!._id);
    expect((await Opportunity.findOne({ providerId: "diff", externalId: "k2" }).lean<OpportunityDoc>())?.sourceState).toBe("LISTED");
    await sync.runFeed(feed!._id);
    const k2 = await Opportunity.findOne({ providerId: "diff", externalId: "k2" }).lean<OpportunityDoc>();
    expect(k2?.sourceState).toBe("REMOVED_AT_SOURCE");
    expect(k2?.activity).toBe("CLOSED");
    expect(k2?.labels).toEqual(expect.arrayContaining(["REMOVED_AT_SOURCE", "CLOSED_OR_EXPIRED"]));
  });

  it("explicit removals close the record; purge-on-removal providers drop the content", async () => {
    const { provider } = makeTestProvider("purge", { purgeOnRemoval: true, capabilities: { incremental: true, pagination: true, publishedAt: true, updatedAt: true, deadline: true, removalDetection: "EXPLICIT", activityCheck: false, employerIdentity: "REGISTRATION_NUMBER", contacts: true, webhooks: false, directApplyLink: false } });
    const feed = await feedFor(provider);
    await ingestItems([item({ externalId: "p1", summary: "Full ad text", contacts: [{ kind: "NAMED_PERSON", name: "Kari", email: "kari@example.test" }] })], { provider, feed: { ...feed!, config: {}, settings: {} } as never });
    await markRemoved(provider, ["p1"], "Source reported INACTIVE");
    const p = await Opportunity.findOne({ providerId: "purge", externalId: "p1" }).lean<OpportunityDoc>();
    expect(p?.activity).toBe("CLOSED");
    expect(p?.summary ?? null).toBeNull();
    expect(p?.contacts).toHaveLength(0);
    expect(p?.contentPurged).toBe(true);
  });

  it("failed status checks never close a record; repeated failures flag it for review", async () => {
    const { provider } = makeTestProvider("chk", {
      capabilities: { incremental: true, pagination: false, publishedAt: true, updatedAt: false, deadline: true, removalDetection: "DEADLINE_ONLY", activityCheck: true, employerIdentity: "NAME_ONLY", contacts: false, webhooks: false, directApplyLink: true },
      checkActivity: async () => ({ status: "UNKNOWN", detail: "Source timed out", failed: true }),
    });
    const feed = await feedFor(provider);
    await ingestItems([item({ externalId: "c1", deadline: new Date(Date.now() + 10 * 86_400_000) })], { provider, feed: { ...feed!, config: {}, settings: {} } as never });
    const doc = await Opportunity.findOne({ providerId: "chk" }).lean<OpportunityDoc>();
    for (let i = 0; i < 3; i++) await sync.checkOpportunity(doc!._id);
    const after = await Opportunity.findOne({ providerId: "chk" }).lean<OpportunityDoc>();
    expect(after?.sourceState).toBe("LISTED");
    expect(after?.activity).not.toBe("CLOSED");
    expect(after?.consecutiveCheckFailures).toBe(3);
    expect(after?.labels).toContain("NEEDS_MANUAL_REVIEW");
  });

  it("stale records become UNKNOWN (not closed) and passed deadlines become EXPIRED", async () => {
    const { provider } = makeTestProvider("stale");
    const old = new Date(Date.now() - 10 * 86_400_000);
    await Opportunity.create([
      { type: "HIRING", providerId: "stale", externalId: "s1", title: "Old", sourceClass: "OFFICIAL_PUBLIC_EMPLOYMENT_SERVICE", sourceVerification: { status: "AUTHORITATIVE_SOURCE" }, sourceState: "LISTED", activity: "ACTIVE", lastSeenAt: old, firstSeenAt: old, organization: { name: "X" } },
      { type: "PROCUREMENT", providerId: "stale", externalId: "s2", title: "Tender", sourceClass: "OFFICIAL_PROCUREMENT_PORTAL", sourceVerification: { status: "AUTHORITATIVE_SOURCE" }, sourceState: "LISTED", activity: "ACTIVE", lastSeenAt: new Date(), deadline: new Date(Date.now() - 3_600_000), organization: { name: "Y" } },
    ]);
    expect(provider.id).toBe("stale");
    await sync.runMaintenance();
    const s1 = await Opportunity.findOne({ providerId: "stale", externalId: "s1" }).lean<OpportunityDoc>();
    const s2 = await Opportunity.findOne({ providerId: "stale", externalId: "s2" }).lean<OpportunityDoc>();
    expect(s1?.activity).toBe("UNKNOWN");
    expect(s1?.sourceState).toBe("LISTED");
    expect(s2?.activity).toBe("EXPIRED");
  });
});

/* ───────────────────────── Filters & metrics ───────────────────────── */

describe("Filters and metrics", () => {
  beforeEach(async () => {
    await Opportunity.deleteMany({ providerId: "flt" });
  });

  it("country, discovery-date and publication-date filters use the right field", async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 36 * 3_600_000);
    await Opportunity.create([
      { type: "HIRING", providerId: "flt", externalId: "1", title: "SE new, published long ago", countryCode: "SE", sourceClass: "OFFICIAL_PUBLIC_EMPLOYMENT_SERVICE", activity: "ACTIVE", firstSeenAt: now, publishedAt: yesterday },
      { type: "HIRING", providerId: "flt", externalId: "2", title: "NO new", countryCode: "NO", sourceClass: "OFFICIAL_PUBLIC_EMPLOYMENT_SERVICE", activity: "ACTIVE", firstSeenAt: now, publishedAt: now },
      { type: "PROCUREMENT", providerId: "flt", externalId: "3", title: "FR tender due soon", countryCode: "FR", sourceClass: "OFFICIAL_PROCUREMENT_PORTAL", activity: "UNKNOWN", firstSeenAt: yesterday, deadline: new Date(now.getTime() + 3 * 86_400_000) },
    ]);
    const bySe = await service.listOpportunities(t.owner.actor, { provider: "flt", country: "SE" });
    expect(bySe.total).toBe(1);
    const discoveredToday = await service.listOpportunities(t.owner.actor, { provider: "flt", country: "SE", dateField: "discovered", preset: "today" });
    expect(discoveredToday.total).toBe(1);
    const publishedToday = await service.listOpportunities(t.owner.actor, { provider: "flt", country: "SE", dateField: "published", preset: "today" });
    expect(publishedToday.total).toBe(0);
    expect(publishedToday.dateWindow?.description).toContain("Europe/Stockholm");
    const deadlineWeek = await service.listOpportunities(t.owner.actor, { provider: "flt", dateField: "deadline", preset: "7d" });
    expect(deadlineWeek.total).toBe(1);
  });

  it("empty filter-form values (\"All\") are ignored — the Hiring page no longer crashes", async () => {
    // Exactly what the GET filter form submits when every select is left on "All".
    const formSubmit = { q: "", country: "", activity: "open", sort: "discovered", dateField: "discovered", preset: "", from: "", to: "", source: "", label: "", employer: "", category: "", direct: "", contact: "", saved: "", review: "", linked: "", company: "", jobCategory: "", archived: "exclude", type: "HIRING" };
    await expect(service.listOpportunities(t.owner.actor, formSubmit)).resolves.toMatchObject({ ignored: [] });
    as(t.owner);
    const qs = new URLSearchParams(formSubmit).toString();
    expect((await listRoute(req(`/api/opportunities?${qs}`), ctx())).status).toBe(200);
    // Invalid values: pages drop them with a notice; the API stays strict (400).
    const lenient = await service.listOpportunities(t.owner.actor, { type: "HIRING", country: "XX", source: "NOPE" }, { lenient: true });
    expect(lenient.ignored.sort()).toEqual(["country", "source"]);
    expect((await listRoute(req("/api/opportunities?country=XX"), ctx())).status).toBe(400);
  });

  it("metrics equal the underlying record counts", async () => {
    const before = await service.getOpportunityStats(t.owner.actor, { periodDays: 7 });
    const now = new Date();
    await Opportunity.create([
      { type: "HIRING", providerId: "flt", externalId: "m1", title: "a", countryCode: "SE", sourceClass: "OFFICIAL_PUBLIC_EMPLOYMENT_SERVICE", activity: "ACTIVE", firstSeenAt: now, organization: { name: "Org One", normalizedName: "org one" } },
      { type: "HIRING", providerId: "flt", externalId: "m2", title: "b", countryCode: "SE", sourceClass: "OFFICIAL_PUBLIC_EMPLOYMENT_SERVICE", activity: "ACTIVE", firstSeenAt: now, organization: { name: "Org One", normalizedName: "org one" } },
      { type: "HIRING", providerId: "flt", externalId: "m3", title: "c", countryCode: "SE", sourceClass: "THIRD_PARTY_AGGREGATOR", activity: "EXPIRED", firstSeenAt: now, organization: { name: "Org Two", normalizedName: "org two" } },
    ]);
    const after = await service.getOpportunityStats(t.owner.actor, { periodDays: 7 });
    expect(after.discovered - before.discovered).toBe(3);
    expect(after.activeChecked - before.activeChecked).toBe(2);
    expect(after.official - before.official).toBe(2);
    expect(after.closed - before.closed).toBe(1);
    // Two postings by one organization count as one hiring organization.
    expect(after.hiringOrgs - before.hiringOrgs).toBe(1);
  });
});

/* ───────────────────────── Pure rules ───────────────────────── */

describe("Trust-model rules", () => {
  const fresh = 2 * 86_400_000;
  it("official source ≠ active: labels are separate dimensions", () => {
    const r = { sourceClass: "OFFICIAL_PROCUREMENT_PORTAL" as const, sourceVerification: { status: "AUTHORITATIVE_SOURCE" }, sourceState: "LISTED", lastSeenAt: new Date(Date.now() - 5 * 86_400_000), organization: { name: "Buyer" } };
    const activity = computeActivity(r, fresh);
    expect(activity).toBe("UNKNOWN");
    const labels = deriveLabels(r, activity, reviewReasons(r, activity));
    expect(labels).toContain("VERIFIED_OFFICIAL_SOURCE");
    expect(labels).not.toContain("ACTIVE_STATUS_CHECKED");
  });

  it("aggregators are unverified and need review", () => {
    const r = { sourceClass: "THIRD_PARTY_AGGREGATOR" as const, sourceVerification: { status: "AGGREGATOR" }, sourceState: "LISTED", lastSeenAt: new Date(), organization: { name: "Some Co" } };
    const a = computeActivity(r, fresh);
    const labels = deriveLabels(r, a, reviewReasons(r, a));
    expect(labels).toEqual(expect.arrayContaining(["UNVERIFIED", "NEEDS_MANUAL_REVIEW", "ACTIVE_STATUS_CHECKED"]));
    expect(labels).not.toContain("VERIFIED_OFFICIAL_SOURCE");
  });

  it("contact routes distinguish employer, procurement and third-party routes", () => {
    expect(deriveContactRoutes({ type: "HIRING", sourceClass: "THIRD_PARTY_AGGREGATOR", thirdPartyUrl: "https://www.adzuna.co.uk/land/ad/1", contacts: [] })).toEqual(["THIRD_PARTY_ROUTE"]);
    expect(deriveContactRoutes({ type: "HIRING", sourceClass: "OFFICIAL_PUBLIC_EMPLOYMENT_SERVICE", applyUrl: "https://acme.teamtailor.com/jobs/1", contacts: [] })).toEqual(["DIRECT_APPLICATION"]);
    expect(deriveContactRoutes({ type: "PROCUREMENT", sourceClass: "OFFICIAL_PROCUREMENT_PORTAL", applyUrl: "https://portal.example/tender", contacts: [{ kind: "NAMED_PERSON", email: "a@agent.example", thirdParty: true }] })).toEqual(["PROCUREMENT_SUBMISSION", "THIRD_PARTY_ROUTE"]);
    expect(deriveContactRoutes({ type: "HIRING", sourceClass: "OFFICIAL_PUBLIC_EMPLOYMENT_SERVICE", contacts: [] })).toEqual(["NONE"]);
  });

  it("agency detection and country attribution", () => {
    expect(looksLikeAgency("Hälsinglands Rekrytering AB")).toBe(true);
    expect(looksLikeAgency("Manpower Bemanning AS")).toBe(true);
    expect(looksLikeAgency("Volvo Cars AB")).toBe(false);
    expect(detectCountry("Remote, France")).toBe("FR");
    expect(detectCountry("Oslo")).toBe("NO");
    expect(detectCountry("Remote - European Union")).toBeUndefined();
    expect(detectCountry("San Francisco, CA")).toBeUndefined();
    expect(detectCountry("Berlin, DE")).toBe("DE");
  });

  it("dates: date-only deadlines are end-of-day; unparseable dates stay undefined", () => {
    expect(parseDeadline("2026-11-09+01:00").deadline?.toISOString()).toBe("2026-11-09T22:59:59.000Z");
    expect(parseDeadline("Snarest")).toEqual({ deadlineText: "Snarest" });
    expect(parseSourceDate("not a date")).toBeUndefined();
    expect(parseSourceDate(undefined)).toBeUndefined();
  });

  it("canonical URL keys ignore tracking parameters and www", () => {
    expect(canonicalUrlKey("https://www.example.com/jobs/1/?utm_source=x&gh_src=y")).toBe(canonicalUrlKey("https://example.com/jobs/1"));
  });

  it("service categories come only from published CPV codes", () => {
    expect(serviceCategoriesFromCpv(["72413000"])).toEqual(["WEB_DEVELOPMENT"]);
    expect(serviceCategoriesFromCpv(["79600000"])).toEqual(["RECRUITMENT_HR"]);
    expect(serviceCategoriesFromCpv(["45000000"])).toEqual([]);
  });

  it("TED notices normalize without inventing missing fields", () => {
    const o = normalizeTedNotice({
      "publication-number": "674610-2026",
      "notice-title": { eng: "Norway – Company health services" },
      "buyer-name": { eng: ["Norwegian Ministry of Foreign Affairs"] },
      "buyer-country": ["NOR"],
      "organisation-identifier-buyer": ["972417920"],
      "publication-date": "2026-10-08+02:00",
      "deadline-receipt-tender-date-lot": ["2026-11-02Z"],
      "classification-cpv": ["79400000"],
      "form-type": "competition",
      "buyer-email": ["procurement@example.test"],
      links: { html: { ENG: "https://ted.europa.eu/en/notice/-/detail/674610-2026" } },
    });
    expect(o.countryCode).toBe("NO");
    expect(o.organization.registrationNumber).toBe("972417920");
    expect(o.deadline?.toISOString()).toBe("2026-11-02T23:59:59.000Z");
    expect(o.applyUrl).toBeUndefined();
    expect(o.sourceUrl).toBe("https://ted.europa.eu/en/notice/-/detail/674610-2026");
  });
});
