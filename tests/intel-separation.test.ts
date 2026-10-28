import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { AuditLog, Company, EstablishedCompany, LeadAssignment, OUTREACH_STATUSES, User, type LeadAssignmentDoc, type UserDoc } from "@/models";
import type { SessionUser } from "@/lib/auth/actor";
import { toActor } from "@/lib/auth/actor";
import type { Actor, Permission } from "@/lib/permissions";
import type { NormalizedCompany } from "@/features/registry/types";
import { identityKeys, nameKeyOf, normalizeCompanyName } from "@/features/established/identity";
import { expectRejects, makeOrg, makeUser } from "./helpers";

/**
 * Startup Company Intelligence (Company collection) and Old company Intelligence
 * (EstablishedCompany collection) are separate datasets with zero overlap; the Digital Marketer
 * table is fully managed by the Owner while marketers can only set the outreach status.
 * Every record is a fixture in the throw-away database.
 */
const session = vi.hoisted(() => ({ current: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => session.current,
  getActor: async () => session.current?.actor ?? null,
}));

const established = await import("@/features/established/service");
const config = await import("@/features/established/config");
const companies = await import("@/features/companies/service");
const marketer = await import("@/features/marketer/service");
const ownerTable = await import("@/features/marketer/owner-table");
const { GET: oldListRoute } = await import("@/app/api/old-companies/route");
const { GET: oldExportRoute } = await import("@/app/api/old-companies/export/route");
const { PUT: oldConfigRoute } = await import("@/app/api/old-companies/config/route");
const { PATCH: marketerPatch } = await import("@/app/api/marketer/leads/[id]/route");
const { GET: ownerListRoute } = await import("@/app/api/marketer/assignments/route");
const { PATCH: ownerPatch, DELETE: ownerDelete } = await import("@/app/api/marketer/assignments/[id]/route");

const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(new URL(url, "http://localhost:3000"), init);
const ctx = <P extends object>(params: P = {} as P) => ({ params: Promise.resolve(params) });
const json = (url: string, method: string, body: unknown) => req(url, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const fresh = async (id: string): Promise<Actor> => toActor((await User.findById(id).lean<UserDoc>())!);
async function as(id: string | null) {
  if (!id) return (session.current = null);
  const actor = await fresh(id);
  session.current = { id: actor.id, name: actor.name, email: actor.email, role: actor.role, status: "ACTIVE", emailVerifiedAt: new Date(), actor };
  return actor;
}

const NOW = new Date();
const daysAgo = (y: number) => new Date(NOW.getTime() - y * 365.25 * 86_400_000).toISOString().slice(0, 10);
const provider = { id: "brreg", sourceName: "Brønnøysundregistrene" };
function rec(id: string, name: string, o: { years?: number; status?: string | null; reg?: string | null; event?: string } = {}): NormalizedCompany {
  return {
    identity: { sourceId: id, name, registrationNumber: o.reg === null ? undefined : (o.reg ?? id) },
    registration: { registrationDay: daysAgo(o.years ?? 12), status: o.status === null ? undefined : (o.status ?? "Active") },
    classification: {},
    contact: {},
    address: { business: { city: "Oslo" } },
    eventType: o.event,
    source: { url: `https://data.brreg.no/enhetsregisteret/oppslag/enheter/${id}` },
  };
}

let ownerId: string;
let marketerA: string;
let marketerB: string;
let staffNoAccess: string;
let viewerNoExport: string;
let clientId: string;
let startupSnapshot: string;

const snapshotStartup = async () => JSON.stringify(await Company.find().sort({ _id: 1 }).lean());

beforeAll(async () => {
  await EstablishedCompany.syncIndexes();
  const owner = (await makeUser("OWNER")).actor;
  ownerId = owner.id;
  const { createInternalUser } = await import("@/features/users/service");
  const account = async (role: "ADMIN" | "STAFF" | "DIGITAL_MARKETER", name: string, permissions: Permission[]) => {
    const { id } = await createInternalUser(owner, { name, email: `sep-${name.toLowerCase().replace(/\W+/g, "-")}@test.local`, role, password: "Strong-test-password-1", permissions });
    await User.updateOne({ _id: id }, { $set: { emailVerifiedAt: new Date() } });
    return String(id);
  };
  marketerA = await account("DIGITAL_MARKETER", "Mia Marketer", ["marketerLeads.view"]);
  marketerB = await account("DIGITAL_MARKETER", "Ben Marketer", ["marketerLeads.view"]);
  staffNoAccess = await account("STAFF", "Sam Staff", []);
  viewerNoExport = await account("ADMIN", "Ada Admin", ["companies.read"]);
  const org = await makeOrg("Client SEP");
  clientId = (await makeUser("CLIENT", { organizationId: org._id, permissions: [] })).actor.id;
  // Startup Company Intelligence: the original register (includes an old-dated record that must NOT leak into Old CI).
  await Company.create([
    { source: "brreg", sourceId: "900000001", registrationNumber: "900000001", companyName: "Rocket Labs AS", countryCode: "NO", registrationDay: daysAgo(0.1), registrationDate: new Date(daysAgo(0.1)), eventType: "NEW_ENTITY", status: "Active", isDemo: false, phone: "+4791234567", website: "https://rocketlabs.no", contactPerson: { name: "Kari Nordmann", role: "CEO" } },
    { source: "brreg", sourceId: "900000002", registrationNumber: "900000002", companyName: "Fjord Startup AS", countryCode: "NO", registrationDay: daysAgo(0.05), registrationDate: new Date(daysAgo(0.05)), eventType: "NEW_ENTITY", status: "Active", isDemo: false },
    { source: "brreg", sourceId: "900000003", registrationNumber: "900000003", companyName: "Legacy In Startup Register AS", countryCode: "NO", registrationDay: daysAgo(20), registrationDate: new Date(daysAgo(20)), eventType: "NEW_ENTITY", status: "Active", isDemo: false, discoveredVia: "ESTABLISHED_COLLECTION" },
  ]);
  startupSnapshot = await snapshotStartup();
});

describe("Old company Intelligence · qualification (configurable, never date alone)", () => {
  it("needs a registration number, a published active status, the age threshold and no branch / startup", () => {
    const q = (n: NormalizedCompany, years = 5) => established.qualifyEstablished(n, years, NOW);
    expect(q(rec("1", "Old AS")).ok).toBe(true);
    expect(q(rec("2", "No Reg AS", { reg: null }))).toMatchObject({ ok: false, reason: "No official registration number" });
    expect(q(rec("3", "No Status AS", { status: null }))).toMatchObject({ ok: false, reason: "No registry status published" });
    expect(q(rec("4", "Closed AS", { status: "Bankrupt" })).ok).toBe(false);
    expect(q(rec("5", "Young AS", { years: 2 })).ok).toBe(false);
    expect(q(rec("6", "Branch NUF", { event: "BRANCH" })).ok).toBe(false);
    // The threshold is its own setting: 7 years → a 6-year-old company is out, at 5 it is in.
    expect(q(rec("7", "Six Years AS", { years: 6 }), 7).ok).toBe(false);
    expect(q(rec("7", "Six Years AS", { years: 6 }), 5).ok).toBe(true);
  });

  it("normalizes names and registration numbers for duplicate checks", () => {
    expect(normalizeCompanyName("ROCKET-LABS A/S")).toBe(normalizeCompanyName("Rocket Labs AS"));
    expect(nameKeyOf("no", "Brønnøy Øl AS")).toBe("NO:bronnoy ol");
    expect(nameKeyOf("FI", "Mäkelä Oy")).toBe(nameKeyOf("FI", "MAKELA OY"));
    expect(identityKeys({ countryCode: "no", source: "brreg", sourceId: "1", registrationNumber: "123 456 789", companyName: "X" })).toEqual(["src:NO:brreg:1", "reg:NO:123456789"]);
  });
});

describe("Old company Intelligence · separate dataset, zero overlap", () => {
  it("stores only in its own collection and refuses anything Startup Company Intelligence holds", async () => {
    const res = await established.storeEstablished(
      provider,
      "NO",
      [
        rec("910000001", "Nordic Timber AS", { years: 30 }),
        rec("910000002", "Bergen Shipping AS", { years: 15 }),
        rec("910000003", "Oslo Bakeri AS", { years: 8 }),
        rec("900000003", "Legacy In Startup Register AS", { years: 20 }), // same registry id / number as a startup record
        rec("910000099", "ROCKET LABS AS", { years: 10, reg: "910000099" }), // same name (other case) as a startup record
        rec("910000004", "Too Young AS", { years: 1 }),
        rec("910000005", "Dissolved Old AS", { years: 20, status: "Deleted" }),
      ],
      { now: NOW, minAgeYears: 5 },
    );
    expect(res).toMatchObject({ received: 7, qualified: 5, excludedAsStartup: 2, imported: 3 });
    expect(await EstablishedCompany.countDocuments()).toBe(3);
    // Startup records are byte-for-byte unchanged.
    expect(await snapshotStartup()).toBe(startupSnapshot);
  });

  it("database level: the same registered company is stored once (unique identity keys)", async () => {
    const again = await established.storeEstablished(provider, "NO", [{ ...rec("other-id", "Nordic Timber AS", { years: 30, reg: "910000001" }) }], { now: NOW, minAgeYears: 5 });
    expect(again.imported).toBe(0);
    expect(again.failed).toBe(1);
    await expect(EstablishedCompany.create({ countryCode: "NO", source: "x", sourceId: "y", companyName: "Dup", nameKey: "NO:dup", registrationNumber: "910000002", identityKeys: ["reg:NO:910000002"], foundedOn: new Date("2000-01-01"), status: "Active", firstSeenAt: NOW, lastSeenAt: NOW })).rejects.toThrow(/duplicate key/);
    expect(await EstablishedCompany.countDocuments()).toBe(3);
  });

  it("sweep: a company that later appears in the startup register leaves Old company Intelligence (startup untouched)", async () => {
    await Company.create({ source: "brreg", sourceId: "910000003", registrationNumber: "910000003", companyName: "Oslo Bakeri AS", countryCode: "NO", registrationDay: daysAgo(0.01), eventType: "NEW_ENTITY", status: "Active", isDemo: false });
    // A normalized-name match too ("BERGEN SHIPPING A/S" vs "Bergen Shipping AS"), different number.
    await Company.create({ source: "brreg", sourceId: "920000001", registrationNumber: "920000001", companyName: "BERGEN SHIPPING A/S", countryCode: "NO", registrationDay: daysAgo(0.01), eventType: "NEW_ENTITY", status: "Active", isDemo: false });
    startupSnapshot = await snapshotStartup();
    expect(await established.sweepStartupOverlap()).toEqual({ checked: 3, removed: 2 });
    expect((await EstablishedCompany.find().lean()).map((c) => c.companyName)).toEqual(["Nordic Timber AS"]);
    expect(await snapshotStartup()).toBe(startupSnapshot);
  });

  it("read time: a record matching a startup registration number is never listed, counted or exported", async () => {
    // Bypass the write-time check on purpose to prove the read guard.
    await EstablishedCompany.create({ countryCode: "NO", source: "brreg", sourceId: "900000001", companyName: "Rocket Labs AS", nameKey: "NO:rocket labs", registrationNumber: "900000001", identityKeys: ["src:NO:brreg:900000001", "reg:NO:900000001"], foundedOn: new Date("2001-01-01"), status: "Active", firstSeenAt: NOW, lastSeenAt: NOW });
    const owner = await fresh(ownerId);
    const list = await established.listOldCompanies(owner, { country: "ALL" });
    expect(list.items.map((r) => r.companyName)).toEqual(["Nordic Timber AS"]);
    expect(list.total).toBe(1);
    const report = await established.isolationReport();
    expect(report.overlap).toBe(1); // the planted row is detected by the report…
    await established.sweepStartupOverlap();
    expect((await established.isolationReport()).overlap).toBe(0); // …and removed by the sweep
  });

  it("Old CI never falls back to startup data: empty dataset → empty list", async () => {
    const owner = await fresh(ownerId);
    const empty = await established.listOldCompanies(owner, { country: "NO", q: "Rocket" });
    expect(empty.items).toEqual([]);
    expect(empty.total).toBe(0);
    // Old-dated startup record ("Legacy In Startup Register AS", 20 years) is not in Old CI.
    expect((await established.listOldCompanies(owner, { country: "NO", q: "Legacy" })).total).toBe(0);
  });

  it("Startup Company Intelligence lists exactly its original records (no Old records, query unchanged)", async () => {
    const owner = await fresh(ownerId);
    const list = await companies.listCompanies(owner, { country: "NO", range: "all", pageSize: 100 });
    const names = list.items.map((c) => c.companyName).sort();
    expect(names).toEqual(["BERGEN SHIPPING A/S", "Fjord Startup AS", "Legacy In Startup Register AS", "Oslo Bakeri AS", "Rocket Labs AS"]);
    expect(names).not.toContain("Nordic Timber AS");
    // The removed Old-CI filter is no longer accepted by the startup query.
    expect((await companies.listCompanies(owner, { country: "NO", range: "all", age: "old", pageSize: 100 })).total).toBe(list.total);
  });

  it("search, threshold, pagination and export are independent; access is enforced", async () => {
    await established.storeEstablished(provider, "NO", [rec("930000001", "Arctic Fisk AS", { years: 6 }), rec("930000002", "Trondheim Tre AS", { years: 40 })], { now: NOW, minAgeYears: 5 });
    await as(ownerId);
    const body = async (r: Response) => (await r.json()) as { items: { companyName: string }[]; total: number; minAgeYears: number };
    expect((await body(await oldListRoute(req("/api/old-companies?country=NO&sort=oldest"), ctx()))).items.map((r) => r.companyName)).toEqual(["Trondheim Tre AS", "Nordic Timber AS", "Arctic Fisk AS"]);
    expect((await body(await oldListRoute(req("/api/old-companies?country=NO&q=fisk"), ctx()))).total).toBe(1);
    expect((await body(await oldListRoute(req("/api/old-companies?country=NO&pageSize=5&page=2"), ctx()))).items).toEqual([]);
    // Owner raises the threshold → the 6-year-old company disappears at once.
    expect((await oldConfigRoute(json("/api/old-companies/config", "PUT", { minAgeYears: 7 }), ctx())).status).toBe(200);
    const after = await body(await oldListRoute(req("/api/old-companies?country=NO"), ctx()));
    expect(after.minAgeYears).toBe(7);
    expect(after.items.map((r) => r.companyName)).not.toContain("Arctic Fisk AS");
    const csv = await (await oldExportRoute(req("/api/old-companies/export?country=NO"), ctx())).text();
    expect(csv).toContain("Trondheim Tre AS");
    expect(csv).not.toContain("Rocket Labs");
    expect(csv).not.toContain("Legacy In Startup");
    await config.setEstablishedConfig(await fresh(ownerId), { minAgeYears: 5 });

    await as(viewerNoExport);
    expect((await oldConfigRoute(json("/api/old-companies/config", "PUT", { minAgeYears: 1 }), ctx())).status).toBe(403);
    for (const id of [staffNoAccess, clientId, marketerA]) {
      await as(id);
      expect([401, 403]).toContain((await oldListRoute(req("/api/old-companies"), ctx())).status);
      expect([401, 403]).toContain((await oldExportRoute(req("/api/old-companies/export"), ctx())).status);
    }
    await as(null);
    expect((await oldListRoute(req("/api/old-companies"), ctx())).status).toBe(401);
    expect(await snapshotStartup()).toBe(startupSnapshot);
  });
});

describe("Digital Marketer table · Owner full access, marketers outreach status only", () => {
  let leadA: string;
  let leadB: string;
  let rocketId: Types.ObjectId;

  beforeAll(async () => {
    const [rocket, fjord] = await Company.find({ companyName: { $in: ["Rocket Labs AS", "Fjord Startup AS"] } }).sort({ companyName: -1 }).lean();
    rocketId = rocket!._id as Types.ObjectId;
    const base = { senderId: new Types.ObjectId(ownerId), countryCode: "NO", status: "ACTIVE", sentAt: new Date(), history: [] };
    // Rows of the shared marketer table (no recipient).
    leadA = String((await LeadAssignment.create({ ...base, companyId: rocketId, recipientId: null }))._id);
    leadB = String((await LeadAssignment.create({ ...base, companyId: fjord!._id, recipientId: null }))._id);
  });

  it("the status dropdown has exactly three values", () => {
    expect([...OUTREACH_STATUSES]).toEqual(["NOT_REACHED", "MESSAGED", "GOT_RESPONSE"]);
  });

  it("every marketer sees the whole shared table and can change only the outreach status (who + when recorded)", async () => {
    const mine = await marketer.listMarketerLeads(await fresh(marketerA), {});
    expect(mine.items.map((r) => r.id).sort()).toEqual([leadA, leadB].sort());
    expect((await marketer.listMarketerLeads(await fresh(marketerB), {})).items.map((r) => r.id).sort()).toEqual([leadA, leadB].sort());
    await as(marketerA);
    const ok = await marketerPatch(json(`/api/marketer/leads/${leadA}`, "PATCH", { outreachStatus: "MESSAGED" }), ctx({ id: leadA }));
    expect(ok.status).toBe(200);
    // Mass assignment / payload manipulation is rejected, nothing changes.
    for (const body of [{ outreachStatus: "GOT_RESPONSE", companyName: "Hacked" }, { outreachStatus: "GOT_RESPONSE", details: { phone: "1" } }, { outreachStatus: "GOT_RESPONSE", status: "WITHDRAWN" }, { companyName: "Hacked" }, { outreachStatus: "Got responce" }]) {
      expect((await marketerPatch(json(`/api/marketer/leads/${leadA}`, "PATCH", body), ctx({ id: leadA }))).status).toBe(400);
    }
    // Unknown ids and rows that aren't in the table: not found.
    expect((await marketerPatch(json(`/api/marketer/leads/${String(new Types.ObjectId())}`, "PATCH", { outreachStatus: "MESSAGED" }), ctx({ id: String(new Types.ObjectId()) }))).status).toBe(404);
    // Owner-only routes: list, edit, delete all 403.
    expect((await ownerListRoute(req("/api/marketer/assignments"), ctx())).status).toBe(403);
    expect((await ownerPatch(json(`/api/marketer/assignments/${leadA}`, "PATCH", { companyName: "Hacked" }), ctx({ id: leadA }))).status).toBe(403);
    expect((await ownerPatch(json(`/api/marketer/assignments/${leadA}`, "PATCH", { outreachStatus: "GOT_RESPONSE" }), ctx({ id: leadA }))).status).toBe(403);
    expect((await ownerDelete(req(`/api/marketer/assignments/${leadA}`, { method: "DELETE" }), ctx({ id: leadA }))).status).toBe(403);
    const stored = (await LeadAssignment.findById(leadA).lean<LeadAssignmentDoc>())!;
    expect(stored).toMatchObject({ outreachStatus: "MESSAGED", status: "ACTIVE" });
    expect(String(stored.outreachStatusBy)).toBe(marketerA);
    expect(stored.history.at(-1)).toMatchObject({ action: "OUTREACH", outreachStatus: "MESSAGED", previousOutreachStatus: "NOT_REACHED" });
    expect(stored.details?.companyName).toBeUndefined();
    for (const id of [staffNoAccess, clientId]) {
      await as(id);
      expect([401, 403]).toContain((await ownerListRoute(req("/api/marketer/assignments"), ctx())).status);
      expect([401, 403]).toContain((await ownerDelete(req(`/api/marketer/assignments/${leadA}`, { method: "DELETE" }), ctx({ id: leadA }))).status);
    }
    await expectRejects(marketer.updateLeadOutreachStatus(await fresh(ownerId), leadA, { outreachStatus: "MESSAGED" }), 403);
  });

  it("the Owner sees all records with the marketers' status changes, edits any field and deletes records", async () => {
    await as(ownerId);
    const list = (await (await ownerListRoute(req("/api/marketer/assignments"), ctx())).json()) as { items: { id: string; outreachStatus: string; outreachStatusBy?: string; history: { by: string; action: string }[] }[]; stats: { total: number; MESSAGED: number } };
    expect(list.items.map((r) => r.id).sort()).toEqual([leadA, leadB].sort());
    const a = list.items.find((r) => r.id === leadA)!;
    expect(a).toMatchObject({ outreachStatus: "MESSAGED", outreachStatusBy: "Mia Marketer" });
    expect(a.history[0]).toMatchObject({ by: "Mia Marketer", action: "OUTREACH" });
    expect(list.stats).toMatchObject({ total: 2, MESSAGED: 1 });

    const companyBefore = JSON.stringify(await Company.findById(rocketId).lean());
    const edit = await ownerPatch(json(`/api/marketer/assignments/${leadA}`, "PATCH", { companyName: "Rocket Labs Norway AS", phone: "+47 22 33 44 55", website: "", outreachStatus: "GOT_RESPONSE" }), ctx({ id: leadA }));
    expect(edit.status).toBe(200);
    const row = (await edit.json()) as { companyName: string; phone?: string; website?: unknown; outreachStatus: string; edited?: { fields: string[] } };
    expect(row).toMatchObject({ companyName: "Rocket Labs Norway AS", phone: "+47 22 33 44 55", outreachStatus: "GOT_RESPONSE" });
    expect(row.website).toBeUndefined();
    expect(row.edited?.fields.sort()).toEqual(["companyName", "phone", "website"]);
    // The startup Company record is untouched; the marketer sees the Owner's values after a refresh.
    expect(JSON.stringify(await Company.findById(rocketId).lean())).toBe(companyBefore);
    const marketerView = (await marketer.listMarketerLeads(await fresh(marketerA), {})).items[0]!;
    expect(marketerView).toMatchObject({ companyName: "Rocket Labs Norway AS", phone: "+47 22 33 44 55", outreachStatus: "GOT_RESPONSE" });
    expect(marketerView.website).toBeUndefined();
    // Entering the Company value again clears the correction.
    await ownerPatch(json(`/api/marketer/assignments/${leadA}`, "PATCH", { companyName: "Rocket Labs AS" }), ctx({ id: leadA }));
    expect((await LeadAssignment.findById(leadA).lean<LeadAssignmentDoc>())!.details?.companyName).toBeUndefined();
    // Owner validation: unknown fields and bad values are rejected.
    expect((await ownerPatch(json(`/api/marketer/assignments/${leadA}`, "PATCH", { recipientId: marketerB }), ctx({ id: leadA }))).status).toBe(400);
    expect((await ownerPatch(json(`/api/marketer/assignments/${leadA}`, "PATCH", { outreachStatus: "DONE" }), ctx({ id: leadA }))).status).toBe(400);
    expect((await ownerPatch(json(`/api/marketer/assignments/${leadA}`, "PATCH", { website: "javascript:alert(1)" }), ctx({ id: leadA }))).status).toBe(400);

    expect((await ownerDelete(req(`/api/marketer/assignments/${leadB}`, { method: "DELETE" }), ctx({ id: leadB }))).status).toBe(200);
    expect(await LeadAssignment.exists({ _id: leadB })).toBeNull();
    expect(await Company.exists({ companyName: "Fjord Startup AS" })).toBeTruthy();
    expect(await AuditLog.exists({ action: "lead.assignment_deleted", entityId: leadB })).toBeTruthy();
    expect(await AuditLog.exists({ action: "lead.assignment_updated", entityId: leadA })).toBeTruthy();
    expect((await marketer.listMarketerLeads(await fresh(marketerB), {})).items.map((r) => r.id)).toEqual([leadA]);
    // Persisted: a fresh read shows the same values to the Owner.
    expect((await ownerTable.listLeadAssignments(await fresh(ownerId), {})).items.map((r) => [r.id, r.outreachStatus])).toEqual([[leadA, "GOT_RESPONSE"]]);
  });
});
