import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { AuditLog, Company, CrmActivity, LeadAssignment, Notification, Opportunity, Project, User, type LeadAssignmentDoc, type ProjectDoc, type UserDoc } from "@/models";
import type { SessionUser } from "@/lib/auth/actor";
import { toActor } from "@/lib/auth/actor";
import { can, COMPANY_INTELLIGENCE_PERMISSIONS, isGrantable, PERMISSION_CATALOG, PERMISSION_DEFS, PERMISSIONS, type Actor, type Permission } from "@/lib/permissions";
import { TEAM_NAV, teamNavigation } from "@/lib/permissions/navigation";
import { safeExternalUrl } from "@/lib/utils/url";
import { expectRejects, makeOrg, makeUser } from "./helpers";

/**
 * Access control: Digital Marketer handoff, per-person grants with provenance, scoped delegation,
 * cascade revocation and the Owner-only rule for Company Intelligence.
 * All records are isolated fixtures in the throw-away test database.
 */
const session = vi.hoisted(() => ({ current: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => session.current,
  getActor: async () => session.current?.actor ?? null,
}));

const access = await import("@/features/access/service");
const users = await import("@/features/users/service");
const marketer = await import("@/features/marketer/service");
const opportunities = await import("@/features/opportunities/service");
const { GET: recipientsRoute, POST: sendRoute } = await import("@/app/api/lead-assignments/route");
const { DELETE: withdrawRoute } = await import("@/app/api/lead-assignments/[id]/route");
const { GET: marketerLeadsRoute } = await import("@/app/api/marketer/leads/route");
const { GET: accessListRoute } = await import("@/app/api/admin/access/route");
const { POST: accessChangeRoute } = await import("@/app/api/admin/users/[id]/access/route");
const { POST: createUserRoute } = await import("@/app/api/admin/users/route");
const { PATCH: patchUserRoute } = await import("@/app/api/admin/users/[id]/route");
const { GET: oppListRoute } = await import("@/app/api/opportunities/route");
const { GET: oppExportRoute } = await import("@/app/api/opportunities/export/route");
const { GET: companiesRoute } = await import("@/app/api/companies/route");
const { GET: companiesExportRoute } = await import("@/app/api/companies/export/route");
const { GET: searchRoute } = await import("@/app/api/search/route");
const { GET: registrationsRoute } = await import("@/app/api/registrations/route");
const { GET: countriesRoute } = await import("@/app/api/countries/route");
const { GET: leadsRoute } = await import("@/app/api/leads/route");
const { GET: pipelineRoute } = await import("@/app/api/crm/pipeline/route");

const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(new URL(url, "http://localhost:3000"), init);
const ctx = <P extends object>(params: P = {} as P) => ({ params: Promise.resolve(params) });
const post = (url: string, body: unknown) => req(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

/** The actor exactly as a request would rebuild it from the database. */
async function fresh(id: string): Promise<Actor> {
  const u = await User.findById(id).lean<UserDoc>();
  return toActor(u!);
}
async function as(id: string | null) {
  if (!id) {
    session.current = null;
    return null;
  }
  const actor = await fresh(id);
  session.current = { id: actor.id, name: actor.name, email: actor.email, role: actor.role, status: "ACTIVE", emailVerifiedAt: new Date(), actor };
  return actor;
}
let seq = 0;
async function account(owner: Actor, role: "ADMIN" | "STAFF" | "DIGITAL_MARKETER", permissions: Permission[] = []) {
  const n = ++seq;
  const { id } = await users.createInternalUser(owner, { name: `${role} person ${n}`, email: `acl-${role.toLowerCase()}-${n}@test.local`, role, password: "Strong-test-password-1", permissions });
  await User.updateOne({ _id: id }, { $set: { emailVerifiedAt: new Date() } });
  return id;
}
async function grant(actorId: string, targetId: string, permission: Permission) {
  return access.changeAccess(await fresh(actorId), targetId, { permission, action: "grant" });
}
async function revoke(actorId: string, targetId: string, permission: Permission) {
  return access.changeAccess(await fresh(actorId), targetId, { permission, action: "revoke" });
}
const holds = async (id: string, p: Permission) => can(await fresh(id), p);

let owner: Actor;
let superAdmin: string;
let superAdmin2: string;
let marketerA: string;
let marketerB: string;
let staffA: string;
let staffB: string;
let companyA: Types.ObjectId;
let companyB: Types.ObjectId;

beforeAll(async () => {
  owner = (await makeUser("OWNER")).actor;
  superAdmin = await account(owner, "ADMIN");
  superAdmin2 = await account(owner, "ADMIN");
  marketerA = await account(owner, "DIGITAL_MARKETER");
  marketerB = await account(owner, "DIGITAL_MARKETER");
  staffA = await account(owner, "STAFF");
  staffB = await account(owner, "STAFF");
  const [a, b] = await Company.create([
    { companyName: "Fjord Analytics AS", countryCode: "NO", source: "fixture", sourceId: "acl-1", registrationNumber: "999000001", contactPerson: { name: "Kari Nordmann", role: "Daglig leder" }, phone: "+47 22 33 44 55", website: "fjord-analytics.no" },
    { companyName: "Baltic Bakers SIA", countryCode: "LV", source: "fixture", sourceId: "acl-2", registrationNumber: "40000000002", phone: "+371 2000 0000", website: "javascript:alert(1)" },
  ]);
  companyA = a!._id;
  companyB = b!._id;
});

describe("New accounts start with no access (default deny)", () => {
  it("a Digital Marketer created by the Owner holds nothing — and never the marketer table by role", async () => {
    const m = await fresh(marketerA);
    expect(m.role).toBe("DIGITAL_MARKETER");
    expect(m.permissions).toEqual([]);
    expect(teamNavigation(m).flatMap((g) => g.items.map((i) => i.href))).toEqual(["/staff", "/staff/notifications", "/staff/settings/security"]);
  });
});

describe("1. Owner sends a lead to a marketer", () => {
  it("persists the assignment, is idempotent and audited", async () => {
    await as(owner.id);
    const list = await recipientsRoute(req(`/api/lead-assignments?companyId=${companyA}`), ctx());
    expect(list.status).toBe(200);
    const { recipients } = (await list.json()) as { recipients: { id: string; canView: boolean }[] };
    expect(recipients.map((r) => r.id)).toEqual(expect.arrayContaining([marketerA, marketerB]));

    const res = await sendRoute(post("/api/lead-assignments", { companyId: String(companyA), recipientId: marketerA }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "sent", visible: false });

    // "Reload": the assignment is in the database with sender, recipient, timestamps and history.
    const stored = await LeadAssignment.findOne({ companyId: companyA, recipientId: marketerA }).lean<LeadAssignmentDoc>();
    expect(stored).toMatchObject({ status: "ACTIVE", senderId: new Types.ObjectId(owner.id) });
    expect(stored!.sentAt).toBeInstanceOf(Date);
    expect(stored!.history).toHaveLength(1);

    // Retries / double clicks never duplicate.
    const again = await sendRoute(post("/api/lead-assignments", { companyId: String(companyA), recipientId: marketerA }), ctx());
    expect(await again.json()).toMatchObject({ status: "already" });
    await Promise.all(Array.from({ length: 5 }, () => marketer.sendLeadToMarketer(owner, String(companyB), { recipientId: marketerB })));
    expect(await LeadAssignment.countDocuments({ companyId: companyB, recipientId: marketerB })).toBe(1);
    expect(await LeadAssignment.countDocuments({ companyId: companyA, recipientId: marketerA })).toBe(1);

    expect(await CrmActivity.exists({ companyId: companyA, type: "ASSIGNMENT" })).toBeTruthy();
    expect(await AuditLog.exists({ action: "lead.sent_to_marketer", entityId: String(companyA) })).toBeTruthy();

    // The picker shows the existing assignment.
    const after = (await (await recipientsRoute(req(`/api/lead-assignments?companyId=${companyA}`), ctx())).json()) as { recipients: { id: string; assignment?: { status: string } }[] };
    expect(after.recipients.find((r) => r.id === marketerA)?.assignment?.status).toBe("ACTIVE");
  });

  it("withdraw and re-send keep one record with history", async () => {
    await as(owner.id);
    const a = await LeadAssignment.findOne({ companyId: companyB, recipientId: marketerB }).lean<LeadAssignmentDoc>();
    expect((await withdrawRoute(req(`/api/lead-assignments/${a!._id}`, { method: "DELETE" }), ctx({ id: String(a!._id) }))).status).toBe(200);
    expect(await marketer.sendLeadToMarketer(owner, String(companyB), { recipientId: marketerB })).toMatchObject({ status: "resent" });
    const back = await LeadAssignment.findById(a!._id).lean<LeadAssignmentDoc>();
    expect(back!.status).toBe("ACTIVE");
    expect(back!.history.map((h) => h.action)).toEqual(["SENT", "WITHDRAWN", "RESENT"]);
  });

  it("rejects invalid recipients, demo companies and non-owners", async () => {
    await expectRejects(marketer.sendLeadToMarketer(owner, String(companyA), { recipientId: staffA }), 400);
    await expectRejects(marketer.sendLeadToMarketer(owner, String(companyA), { recipientId: String(new Types.ObjectId()) }), 400);
    const demo = await Company.create({ companyName: "Demo Co", countryCode: "NO", source: "fixture", sourceId: "acl-demo", isDemo: true });
    await expectRejects(marketer.sendLeadToMarketer(owner, String(demo._id), { recipientId: marketerA }), 400);
    for (const id of [superAdmin, staffA, marketerA]) {
      await as(id);
      expect((await sendRoute(post("/api/lead-assignments", { companyId: String(companyA), recipientId: marketerA }), ctx())).status).toBe(403);
      expect((await recipientsRoute(req(`/api/lead-assignments?companyId=${companyA}`), ctx())).status).toBe(403);
    }
  });
});

describe("2. A marketer without “View Assigned Client Leads” sees nothing", () => {
  it("no menu entry, 403 from the API and the service — even with an assignment", async () => {
    const m = await as(marketerA);
    expect(await LeadAssignment.countDocuments({ recipientId: marketerA, status: "ACTIVE" })).toBeGreaterThan(0);
    expect(teamNavigation(m!).flatMap((g) => g.items).some((i) => i.href === "/staff/client-leads")).toBe(false);
    const res = await marketerLeadsRoute(req("/api/marketer/leads"), ctx());
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain("Fjord");
    await expectRejects(marketer.listMarketerLeads(m!, {}), 403);
  });
});

describe("3. After the Owner grants it, the marketer sees only their own leads", () => {
  it("returns only assigned leads with the four fields, sanitized websites and phone numbers", async () => {
    await grant(owner.id, marketerA, "marketerLeads.view");
    await grant(owner.id, marketerB, "marketerLeads.view");
    const m = await as(marketerA);
    expect(teamNavigation(m!).flatMap((g) => g.items).some((i) => i.href === "/staff/client-leads")).toBe(true);
    const res = await marketerLeadsRoute(req("/api/marketer/leads"), ctx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { companyName: string; contactPerson?: string; phone?: string; website?: { href: string; display: string } }[]; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({ companyName: "Fjord Analytics AS", contactPerson: "Kari Nordmann", phone: "+47 22 33 44 55", website: { href: "https://fjord-analytics.no/", display: "fjord-analytics.no" } });
    expect(JSON.stringify(body)).not.toContain("Baltic"); // assigned to marketer B only

    const b = await fresh(marketerB);
    const theirs = await marketer.listMarketerLeads(b, {});
    expect(theirs.items.map((i) => i.companyName)).toEqual(["Baltic Bakers SIA"]);
    expect(theirs.items[0]!.website).toBeUndefined(); // javascript: is never linked

    // Search by digits, sorting and pagination are server-side.
    expect((await marketer.listMarketerLeads(m!, { q: "2233" })).total).toBe(1);
    expect((await marketer.listMarketerLeads(m!, { q: "nothing-like-this" })).total).toBe(0);
    expect((await marketer.listMarketerLeads(m!, { sort: "company", dir: "asc", page: 1, pageSize: 5 })).pageSize).toBe(5);
  });

  it("revoking the permission hides the table on the very next request", async () => {
    await revoke(owner.id, marketerB, "marketerLeads.view");
    await as(marketerB);
    expect((await marketerLeadsRoute(req("/api/marketer/leads"), ctx())).status).toBe(403);
    await grant(owner.id, marketerB, "marketerLeads.view");
  });
});

describe("4–5. Delegated marketer-lead access needs the scoped Owner grant", () => {
  it("a Super Admin without the scoped authority cannot enable the table (service and API)", async () => {
    const marketerC = await account(owner, "DIGITAL_MARKETER");
    await expectRejects(grant(superAdmin, marketerC, "marketerLeads.view"), 403);
    await as(superAdmin);
    expect((await accessChangeRoute(post(`/api/admin/users/${marketerC}/access`, { permission: "marketerLeads.view", action: "grant" }), ctx({ id: marketerC }))).status).toBe(403);
    expect(await holds(marketerC, "marketerLeads.view")).toBe(false);
  });

  it("with Owner-granted “Manage Marketer Lead Access” the Super Admin can grant it — and nothing else", async () => {
    const marketerC = await account(owner, "DIGITAL_MARKETER");
    await grant(owner.id, superAdmin, "marketerLeads.grant");
    await as(superAdmin);
    const res = await accessChangeRoute(post(`/api/admin/users/${marketerC}/access`, { permission: "marketerLeads.view", action: "grant" }), ctx({ id: marketerC }));
    expect(res.status).toBe(200);
    expect(await holds(marketerC, "marketerLeads.view")).toBe(true);
    const stored = await User.findById(marketerC).lean<UserDoc & { permissionGrants: { permission: string; origin: string; via?: string; grantedBy?: Types.ObjectId }[] }>();
    expect(stored!.permissionGrants).toEqual([expect.objectContaining({ permission: "marketerLeads.view", origin: "DELEGATED", via: "marketerLeads.grant", grantedBy: new Types.ObjectId(superAdmin) })]);
    // Scoped: no other grants, no other targets.
    await expectRejects(grant(superAdmin, marketerC, "opportunities.view"), 403);
    await expectRejects(grant(superAdmin, staffA, "marketerLeads.view"), 403);
    await expectRejects(grant(superAdmin, superAdmin2, "marketerLeads.grant"), 403);
    await expectRejects(grant(superAdmin, staffA, "tickets.manage"), 403);
    await expectRejects(grant(superAdmin, superAdmin, "marketerLeads.view"), 403);
    expect(await AuditLog.exists({ action: "permission.granted", entityId: marketerC, "metadata.via": "marketerLeads.grant" })).toBeTruthy();
  });
});

describe("6. Company Intelligence is Owner-only — nobody else, by any route", () => {
  it("the catalog marks every Company Intelligence entry non-delegable", () => {
    expect(COMPANY_INTELLIGENCE_PERMISSIONS).toEqual(expect.arrayContaining(["companies.read", "companies.export", "companies.edit", "registry.sync", "leads.sendToMarketer"]));
    for (const p of COMPANY_INTELLIGENCE_PERMISSIONS) {
      expect(isGrantable(p)).toBe(false);
      expect(PERMISSION_DEFS[p].eligibleRoles).toEqual([]);
    }
  });

  it("forged grants are refused: Owner UI/API, payloads, account creation and role escalation", async () => {
    for (const p of COMPANY_INTELLIGENCE_PERMISSIONS) await expectRejects(grant(owner.id, superAdmin, p), 403);
    await as(owner.id);
    const forged = await accessChangeRoute(post(`/api/admin/users/${superAdmin}/access`, { permission: "companies.read", action: "grant" }), ctx({ id: superAdmin }));
    expect(forged.status).toBe(403);
    expect(((await forged.json()) as { error: { message: string } }).error.message).toMatch(/Owner-only/);
    expect((await accessChangeRoute(post(`/api/admin/users/${superAdmin}/access`, { permission: "everything.*", action: "grant" }), ctx({ id: superAdmin }))).status).toBe(400);
    expect((await createUserRoute(post("/api/admin/users", { name: "Sneaky", email: "sneaky@test.local", role: "STAFF", password: "Strong-test-password-1", permissions: ["companies.read"] }), ctx())).status).toBe(403);
    await as(superAdmin);
    expect((await patchUserRoute(req(`/api/admin/users/${superAdmin2}`, { method: "PATCH", body: JSON.stringify({ role: "OWNER" }) }), ctx({ id: superAdmin2 }))).status).toBe(403);
  });

  it("a grant written straight into the database is never effective", async () => {
    await User.collection.updateOne({ _id: new Types.ObjectId(superAdmin) }, { $push: { permissionGrants: { permission: "companies.read", grantedBy: null, origin: "OWNER", grantedAt: new Date() } as never }, $addToSet: { permissions: "companies.read" } });
    expect(await holds(superAdmin, "companies.read")).toBe(false);
    // Even a hand-built actor object claiming the permission is refused.
    expect(can({ ...(await fresh(superAdmin)), permissions: [...PERMISSIONS] }, "companies.read")).toBe(false);
  });

  it("every Company Intelligence API answers 403 to every non-owner, without data", async () => {
    const calls: [string, () => Promise<Response>][] = [
      ["companies", () => companiesRoute(req("/api/companies"), ctx())],
      ["companies/export", () => companiesExportRoute(req("/api/companies/export"), ctx())],
      ["search", () => searchRoute(req("/api/search?q=Fjord"), ctx())],
      ["registrations", () => registrationsRoute(req("/api/registrations"), ctx())],
      ["countries", () => countriesRoute(req("/api/countries"), ctx())],
      ["leads", () => leadsRoute(req("/api/leads"), ctx())],
      ["crm/pipeline", () => pipelineRoute(req("/api/crm/pipeline"), ctx())],
    ];
    // Give the Super Admin every grantable permission first: still no Company Intelligence.
    for (const d of PERMISSION_CATALOG.filter((x) => isGrantable(x.key) && x.eligibleRoles.includes("ADMIN"))) await grant(owner.id, superAdmin2, d.key);
    for (const id of [superAdmin, superAdmin2, staffA, marketerA]) {
      await as(id);
      for (const [, call] of calls) {
        const res = await call();
        expect(res.status).toBe(403);
        expect(JSON.stringify(await res.json())).not.toContain("Fjord");
      }
    }
    await as(owner.id);
    expect((await countriesRoute(req("/api/countries"), ctx())).status).toBe(200);
  });

  it("the Owner's permission page offers no control for Owner-only entries", async () => {
    const [view] = await access.listAccess(owner).then((all) => all.filter((u) => u.id === superAdmin));
    for (const row of view!.rows.filter((r) => PERMISSION_DEFS[r.key].ownerOnly)) {
      expect(row.canGrant).toBe(false);
      expect(row.canRevoke).toBe(false);
    }
  });
});

describe("7–9. Opportunity Intelligence delegation", () => {
  it("7. view access alone does not allow granting it", async () => {
    await grant(owner.id, superAdmin, "opportunities.view");
    await expectRejects(grant(superAdmin, staffA, "opportunities.view"), 403);
    expect(await holds(staffA, "opportunities.view")).toBe(false);
  });

  it("8. view + scoped grant authority allows granting OI view — and no other permission", async () => {
    await grant(owner.id, superAdmin, "opportunities.grant");
    await grant(superAdmin, staffA, "opportunities.view");
    await grant(superAdmin, staffB, "opportunities.view");
    expect(await holds(staffA, "opportunities.view")).toBe(true);
    await Opportunity.create({ type: "HIRING", providerId: "acl-test", externalId: "o1", title: "Delegated tender", sourceClass: "OFFICIAL_PROCUREMENT_PORTAL", countryCode: "FR", activity: "ACTIVE", notes: [{ text: "Owner private note", authorId: new Types.ObjectId(owner.id) }] as never, saved: true });
    await as(staffA);
    const list = await oppListRoute(req("/api/opportunities?activity=all"), ctx());
    expect(list.status).toBe(200);
    const text = JSON.stringify(await list.json());
    expect(text).toContain("Delegated tender");
    expect(text).not.toContain("Owner private note");
    expect(text).not.toContain('"saved"');
    expect((await oppExportRoute(req("/api/opportunities/export"), ctx())).status).toBe(403); // exports stay Owner-only
    await expectRejects(opportunities.updateOpportunity(await fresh(staffA), String((await Opportunity.findOne({ externalId: "o1" }))!._id), { saved: false }), 403);
    // Grant authority is scoped to OI view only.
    await expectRejects(grant(superAdmin, superAdmin2, "opportunities.grant"), 403);
    await expectRejects(grant(superAdmin, staffA, "users.manage"), 403);
    await expectRejects(grant(superAdmin, staffA, "companies.read"), 403);
  });

  it("9. revoking the delegation removes dependent grants but keeps independent Owner grants", async () => {
    await grant(owner.id, staffB, "opportunities.view"); // independent Owner grant
    // A delegate can't remove the Owner's grant: their own is removed, the Owner's stays.
    await revoke(superAdmin, staffB, "opportunities.view");
    expect(await holds(staffB, "opportunities.view")).toBe(true);
    await grant(superAdmin, staffB, "opportunities.view");

    await revoke(owner.id, superAdmin, "opportunities.grant");
    expect(await holds(staffA, "opportunities.view")).toBe(false); // delegated only → revoked
    expect(await holds(staffB, "opportunities.view")).toBe(true); // Owner grant survives
    const b = await User.findById(staffB).lean<UserDoc & { permissionGrants: { permission: string; origin: string }[] }>();
    expect(b!.permissionGrants.filter((g) => g.permission === "opportunities.view").map((g) => g.origin)).toEqual(["OWNER"]);
    expect(await AuditLog.exists({ action: "permission.revoked", entityId: staffA, "metadata.reason": "CASCADE_GRANTOR_LOST_AUTHORITY" })).toBeTruthy();
    await as(staffA);
    expect((await oppListRoute(req("/api/opportunities"), ctx())).status).toBe(403);

    // Losing the view permission (while keeping grant authority) also invalidates downstream grants.
    await grant(owner.id, superAdmin, "opportunities.grant");
    await grant(superAdmin, staffA, "opportunities.view");
    await revoke(owner.id, superAdmin, "opportunities.view");
    expect(await holds(staffA, "opportunities.view")).toBe(false);
  });
});

describe("10. The catalog covers every authenticated navigation feature", () => {
  const appDir = path.join(process.cwd(), "src", "app", "(app)");
  const sections = (area: string) =>
    fs
      .readdirSync(path.join(appDir, area), { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("[") && !d.name.startsWith("("))
      .map((d) => `/${area}/${d.name}`);
  const unlocks = new Set(PERMISSION_CATALOG.flatMap((d) => d.unlocks.filter((u) => u.startsWith("/"))));
  const personal = ["/dashboard/overview", "/dashboard/notifications", "/dashboard/settings", "/dashboard/clients", "/dashboard/inquiries", "/dashboard/messages", "/dashboard/projects", "/dashboard/tickets", "/dashboard/services", "/dashboard/service-management", "/dashboard/users", "/staff/notifications", "/staff/settings"];

  it("every /dashboard section is Owner-only or has a catalog entry, and every /staff section has a permissioned nav item", () => {
    const covered = (href: string) => [...unlocks].some((u) => href === u || u.startsWith(`${href}/`) || href.startsWith(`${u}/`));
    for (const s of sections("dashboard")) {
      const staffTwin = s.replace("/dashboard", "/staff");
      expect(covered(s) || covered(staffTwin) || personal.includes(s), `${s} is not represented in the permission catalog`).toBe(true);
    }
    const navHrefs = TEAM_NAV.flatMap((g) => g.items);
    for (const s of sections("staff").filter((x) => !personal.includes(x))) {
      const item = navHrefs.find((i) => i.href === s || i.href.startsWith(`${s}/`) || i.href.startsWith(`${s}?`));
      expect(item, `${s} has no navigation entry`).toBeTruthy();
      expect(item!.requires?.length, `${s} is not tied to a permission`).toBeTruthy();
      for (const p of item!.requires!) expect(PERMISSION_DEFS[p], `${p} missing from catalog`).toBeTruthy();
    }
  });

  it("changing a permission changes both the navigation and the API", async () => {
    let m = await as(marketerA);
    expect(teamNavigation(m!).flatMap((g) => g.items).some((i) => i.href === "/staff/opportunities")).toBe(false);
    expect((await oppListRoute(req("/api/opportunities"), ctx())).status).toBe(403);
    await grant(owner.id, marketerA, "opportunities.view");
    m = await as(marketerA);
    expect(teamNavigation(m!).flatMap((g) => g.items).some((i) => i.href === "/staff/opportunities")).toBe(true);
    expect((await oppListRoute(req("/api/opportunities"), ctx())).status).toBe(200);
    await revoke(owner.id, marketerA, "opportunities.view");
    await as(marketerA);
    expect((await oppListRoute(req("/api/opportunities"), ctx())).status).toBe(403);
  });

  it("the access page lists only what a delegate may manage", async () => {
    await as(superAdmin2);
    const res = await accessListRoute(req("/api/admin/access"), ctx());
    expect(res.status).toBe(200);
    const { users: list } = (await res.json()) as { users: { id: string; role: string; rows: { key: string }[] }[] };
    expect(list.some((u) => u.role === "OWNER" || u.id === superAdmin2)).toBe(false);
    const keys = new Set(list.flatMap((u) => u.rows.map((r) => r.key)));
    for (const k of keys) expect(PERMISSION_DEFS[k as Permission].ownerOnly).toBeFalsy();
    await as(marketerA);
    expect((await accessListRoute(req("/api/admin/access"), ctx())).status).toBe(403);
  });
});

describe("Existing accounts and role changes", () => {
  it("accounts from before per-person grants keep exactly their access when migrated", async () => {
    const legacy = await makeUser("STAFF", { permissions: ["tickets.manage"] });
    const before = [...legacy.actor.permissions].sort();
    expect(before).toEqual(["conversations.assigned", "projects.assigned", "tickets.assigned", "tickets.manage"]);
    await access.ensureGrantsRecorded(legacy.user._id);
    await access.ensureGrantsRecorded(legacy.user._id); // idempotent
    const after = await fresh(String(legacy.user._id));
    expect([...after.permissions].sort()).toEqual(before);
    const stored = await User.findById(legacy.user._id).lean<UserDoc & { permissionGrants: { origin: string }[] }>();
    expect(stored!.permissionGrants.every((g) => g.origin === "MIGRATION")).toBe(true);
    expect(stored!.permissionGrants).toHaveLength(4);
  });

  it("a role change never adds access and drops what the new role can't hold", async () => {
    const m = await account(owner, "DIGITAL_MARKETER");
    await grant(owner.id, m, "marketerLeads.view");
    await users.updateInternalUser(owner, m, { role: "STAFF" });
    const a = await fresh(m);
    expect(a.role).toBe("STAFF");
    expect(a.permissions).toEqual([]);
    await users.updateInternalUser(owner, m, { role: "ADMIN" });
    expect((await fresh(m)).permissions).toEqual([]);
  });

  it("a Super Admin with staff management may only pass on staff permissions they hold, to Staff", async () => {
    const admin = await account(owner, "ADMIN", ["users.manage", "tickets.manage"]);
    const s = await account(owner, "STAFF");
    await grant(admin, s, "tickets.manage");
    await expectRejects(grant(admin, s, "chat.manage"), 403); // not held by the admin
    await expectRejects(grant(admin, s, "analytics.view"), 403); // Owner grants only
    await expectRejects(grant(admin, marketerB, "tickets.manage"), 403); // not a Staff account
    expect(await holds(s, "tickets.manage")).toBe(true);
  });
});

describe("Owner deletes accounts and turns clients into team members", () => {
  it("the Owner deletes a team account; its assignments are cleared and staff grants it made stay", async () => {
    const org = await makeOrg();
    const admin = await account(owner, "ADMIN", ["users.manage", "tickets.manage"]);
    const s = await account(owner, "STAFF");
    await grant(admin, s, "tickets.manage");
    const project = await Project.create({ organizationId: org._id, name: "Site", assignedStaff: [new Types.ObjectId(admin)] });
    await Notification.create({ userId: new Types.ObjectId(admin), type: "ACCOUNT", title: "Hi" });
    await users.deleteUserAccount(owner, admin);
    expect(await User.exists({ _id: admin })).toBeNull();
    expect((await Project.findById(project._id).lean<ProjectDoc>())!.assignedStaff).toHaveLength(0);
    expect(await Notification.countDocuments({ userId: admin })).toBe(0);
    expect(await holds(s, "tickets.manage")).toBe(true); // not a scoped delegation, so no cascade
    expect(await AuditLog.exists({ action: "user.deleted", entityId: admin })).toBeTruthy();
  });

  it("the Owner deletes a client account", async () => {
    const org = await makeOrg();
    const { user } = await makeUser("CLIENT", { organizationId: org._id, permissions: [] });
    await users.deleteUserAccount(owner, String(user._id));
    expect(await User.exists({ _id: user._id })).toBeNull();
  });

  it("nobody else may delete, the Owner can't delete themselves, and the last Owner stays", async () => {
    const admin = await account(owner, "ADMIN", ["users.manage"]);
    const s = await account(owner, "STAFF");
    await expectRejects(users.deleteUserAccount(await fresh(admin), s), 403);
    await expectRejects(users.deleteUserAccount(owner, owner.id), 400);
    const { actor: other } = await makeUser("OWNER");
    await User.updateMany({ role: "OWNER", _id: { $ne: other.id } }, { $set: { status: "SUSPENDED" } });
    try {
      await expectRejects(users.deleteUserAccount(owner, other.id), 400);
    } finally {
      await User.updateMany({ role: "OWNER" }, { $set: { status: "ACTIVE" } });
    }
  });

  it("the Owner turns a client into a team member with a role; they leave the organization and are signed out", async () => {
    const org = await makeOrg();
    const { user } = await makeUser("CLIENT", { organizationId: org._id, permissions: [] });
    const id = String(user._id);
    await users.convertClientToTeamMember(owner, id, { role: "STAFF", permissions: ["tickets.manage"] });
    const after = await User.findById(id).lean<UserDoc>();
    expect(after!.role).toBe("STAFF");
    expect(after!.status).toBe("ACTIVE");
    expect(after!.organizationId).toBeUndefined();
    expect(after!.sessionVersion).toBe((user.sessionVersion ?? 0) + 1);
    expect(await holds(id, "tickets.manage")).toBe(true);
    await expectRejects(users.convertClientToTeamMember(owner, id, { role: "ADMIN" }), 404); // no longer a client
  });

  it("only the Owner converts clients, and never into a client role", async () => {
    const org = await makeOrg();
    const { user } = await makeUser("CLIENT", { organizationId: org._id, permissions: [] });
    const admin = await account(owner, "ADMIN", ["users.manage"]);
    await expectRejects(users.convertClientToTeamMember(await fresh(admin), String(user._id), { role: "STAFF" }), 403);
    await expectRejects(users.convertClientToTeamMember(owner, String(user._id), { role: "CLIENT" }), 400);
    await expectRejects(users.convertClientToTeamMember(owner, String(user._id), { role: "DIGITAL_MARKETER", permissions: ["companies.read"] }), 403);
  });
});

describe("Safe external links", () => {
  it("links only http(s) URLs with a real host", () => {
    expect(safeExternalUrl("example.com")).toEqual({ href: "https://example.com/", display: "example.com" });
    expect(safeExternalUrl("https://www.example.com/about/")).toEqual({ href: "https://www.example.com/about/", display: "example.com/about" });
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "https://user:pw@example.com", "http://localhost", "ftp://example.com", "exa mple.com", "", null]) expect(safeExternalUrl(bad)).toBeNull();
  });
});
