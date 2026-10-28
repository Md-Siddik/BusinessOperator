import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { AuditLog, Company, LeadAssignment, SystemSetting, User, type UserDoc } from "@/models";
import { loadSessionUser, type SessionUser } from "@/lib/auth/actor";
import { SESSION_COOKIE, signSession, type SessionPayload } from "@/lib/auth/token";
import { ROLE_TEMPLATES, effectivePermissions, type Permission, type Role } from "@/lib/permissions";
import { teamNavigation } from "@/lib/permissions/navigation";
import { expectRejects, makeUser } from "./helpers";

/**
 * Digital Marketer table by role (safe, throw-away test records only):
 *  - Owner and "Super Admin" (an Admin granted "Manage Marketer Table"): the management table — view, edit, delete.
 *  - Admin: the regular table, read only. No management page, nav entry or API.
 *  - Digital Marketer: unchanged — the regular table and outreach status.
 */
const session = vi.hoisted(() => ({ current: null as SessionUser | null }));
vi.mock("@/lib/auth/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/session")>()),
  getSessionUser: async () => session.current,
  getActor: async () => session.current?.actor ?? null,
}));

const access = await import("@/features/access/service");
const marketer = await import("@/features/marketer/service");
const { runAdminMarketerTableMigration, revertPendingHandoffAccess, ADMIN_TABLE_MIGRATION_KEY } = await import("@/features/marketer/handoff-migration");
const { GET: tableRoute } = await import("@/app/api/marketer/leads/route");
const { PATCH: statusRoute } = await import("@/app/api/marketer/leads/[id]/route");
const { GET: manageList } = await import("@/app/api/marketer/assignments/route");
const { PATCH: managePatch, DELETE: manageDelete } = await import("@/app/api/marketer/assignments/[id]/route");
const { POST: sendRoute } = await import("@/app/api/lead-assignments/route");
const { proxy } = await import("@/proxy");

const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(new URL(url, "http://localhost:3000"), init);
const json = (url: string, body: unknown, method = "POST") => req(url, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const ctx = <P extends object>(params: P = {} as P) => ({ params: Promise.resolve(params) });

async function as(id: unknown) {
  const u = await User.findById(id).lean<UserDoc>();
  const payload: SessionPayload = { sub: String(u!._id), role: u!.role as Role, sv: u!.sessionVersion ?? 0, mf: true };
  session.current = await loadSessionUser(payload);
  return session.current!.actor;
}
/** A team account whose access is recorded grants by the Owner (as real accounts are). */
async function account(role: Role, permissions: Permission[]) {
  const u = await makeUser(role, { permissions: [] });
  await User.updateOne({ _id: u.user._id }, { $set: { permissionGrants: [], permissions: [] } });
  for (const permission of permissions) await access.changeAccess(await as(owner.user._id), String(u.user._id), { permission, action: "grant" });
  return String(u.user._id);
}
let n = 0;
async function sendTestLead(name: string) {
  const c = await Company.create({ companyName: name, countryCode: "NO", source: "fixture", sourceId: `roles-${++n}`, registrationNumber: `77${n}000000`, contactPerson: { name: "Test Contact" }, phone: "+47 22 00 00 0" + n, website: `test-${n}.example` });
  await as(owner.user._id);
  const res = await sendRoute(json("/api/lead-assignments", { companyId: String(c._id) }), ctx());
  expect(res.status).toBe(200);
  return ((await res.json()) as { assignmentId: string }).assignmentId;
}

let owner: Awaited<ReturnType<typeof makeUser>>;
let superAdmin: string;
let admin: string;
let dm: string;
let lead1: string;
let lead2: string;
beforeAll(async () => {
  owner = await makeUser("OWNER");
  superAdmin = await account("ADMIN", ["marketerLeads.view", "marketerTable.manage"]);
  admin = await account("ADMIN", ["marketerLeads.view"]);
  dm = await account("DIGITAL_MARKETER", ["marketerLeads.view"]);
  lead1 = await sendTestLead("Roles Test One AS");
  lead2 = await sendTestLead("Roles Test Two AS");
});

describe("Permissions", () => {
  it("Admins read the table by role template; managing it is a separate Owner-only grant for Admins", async () => {
    expect(ROLE_TEMPLATES.ADMIN).toContain("marketerLeads.view");
    expect(ROLE_TEMPLATES.ADMIN).not.toContain("marketerTable.manage");
    for (const role of ["DIGITAL_MARKETER", "MANAGER", "STAFF", "CLIENT"] as const) expect(effectivePermissions(role, [], [{ permission: "marketerTable.manage" }])).toEqual([]);
    expect(effectivePermissions("ADMIN", [], [{ permission: "marketerTable.manage" }])).toEqual(["marketerTable.manage"]);
    // An Admin who manages staff accounts still can't hand it out.
    const delegate = await account("ADMIN", ["users.manage", "marketerLeads.grant"]);
    const target = await account("ADMIN", []);
    await expectRejects(access.changeAccess(await as(delegate), target, { permission: "marketerTable.manage", action: "grant" }), 403);
  });
});

describe("Owner: management table — view, edit, delete", () => {
  it("lists every record and edits and deletes them through the API", async () => {
    await as(owner.user._id);
    const list = await manageList(req("/api/marketer/assignments"), ctx());
    expect(list.status).toBe(200);
    const ids = ((await list.json()) as { items: { id: string }[] }).items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining([lead1, lead2]));
    const edit = await managePatch(json(`/api/marketer/assignments/${lead1}`, { contactPerson: "Edited By Owner" }, "PATCH"), ctx({ id: lead1 }));
    expect(edit.status).toBe(200);
    expect(((await edit.json()) as { contactPerson: string }).contactPerson).toBe("Edited By Owner");
  });

  it("the Owner page and nav entry exist and stay Owner-only", async () => {
    const cookie = async (role: Role) => `${SESSION_COOKIE}=${await signSession({ sub: String(new Types.ObjectId()), role, sv: 0 })}`;
    expect((await proxy(req("/dashboard/marketer-leads", { headers: { cookie: await cookie("OWNER") } }))).headers.get("location")).toBeNull();
    expect((await proxy(req("/dashboard/marketer-leads", { headers: { cookie: await cookie("ADMIN") } }))).status).toBe(404);
    // The Owner opening the team-workspace URL lands on their own management page.
    expect((await proxy(req("/staff/marketer-table", { headers: { cookie: await cookie("OWNER") } }))).headers.get("location")).toMatch(/\/dashboard\/marketer-leads$/);
  });
});

describe("Super Admin (Admin with “Manage Marketer Table”): same management capabilities", () => {
  it("sees the management page in the nav, lists, edits and deletes records", async () => {
    const me = await as(superAdmin);
    const hrefs = teamNavigation(me).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toEqual(expect.arrayContaining(["/staff/client-leads", "/staff/marketer-table"]));
    expect((await manageList(req("/api/marketer/assignments"), ctx())).status).toBe(200);
    const edit = await managePatch(json(`/api/marketer/assignments/${lead1}`, { companyName: "Roles Test One Edited AS", outreachStatus: "MESSAGED" }, "PATCH"), ctx({ id: lead1 }));
    expect(edit.status).toBe(200);
    expect(await AuditLog.exists({ action: "lead.assignment_updated", entityId: lead1, actorId: new Types.ObjectId(superAdmin) })).toBeTruthy();

    // The change shows everywhere at once: the Digital Marketer's and the Admin's table.
    for (const id of [dm, admin]) {
      const row = (await marketer.listMarketerLeads(await as(id), { q: "Roles Test One" })).items[0]!;
      expect(row).toMatchObject({ id: lead1, companyName: "Roles Test One Edited AS", contactPerson: "Edited By Owner", outreachStatus: "MESSAGED" });
    }

    await as(superAdmin);
    expect((await manageDelete(req(`/api/marketer/assignments/${lead2}`, { method: "DELETE" }), ctx({ id: lead2 }))).status).toBe(200);
    expect(await LeadAssignment.exists({ _id: lead2 })).toBeNull();
    for (const id of [dm, admin]) expect((await marketer.listMarketerLeads(await as(id), {})).items.map((i) => i.id)).not.toContain(lead2);
    // The Owner's management view reflects it too.
    await as(owner.user._id);
    const ownerIds = ((await (await manageList(req("/api/marketer/assignments"), ctx())).json()) as { items: { id: string }[] }).items.map((i) => i.id);
    expect(ownerIds).toContain(lead1);
    expect(ownerIds).not.toContain(lead2);
  });

  it("losing the grant closes the management table on the next request", async () => {
    await access.changeAccess(await as(owner.user._id), superAdmin, { permission: "marketerTable.manage", action: "revoke" });
    await as(superAdmin);
    expect((await manageList(req("/api/marketer/assignments"), ctx())).status).toBe(403);
    await access.changeAccess(await as(owner.user._id), superAdmin, { permission: "marketerTable.manage", action: "grant" });
  });
});

describe("Admin: the regular table, read only", () => {
  it("sees the same table and records as a Digital Marketer", async () => {
    const asAdmin = await marketer.listMarketerLeads(await as(admin), {});
    const asDm = await marketer.listMarketerLeads(await as(dm), {});
    expect(asAdmin.items.map((i) => i.id)).toEqual(asDm.items.map((i) => i.id));
    await as(admin);
    expect((await tableRoute(req("/api/marketer/leads"), ctx())).status).toBe(200);
    const hrefs = teamNavigation(session.current!.actor).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain("/staff/client-leads");
    expect(hrefs).not.toContain("/staff/marketer-table");
  });

  it("can't change a status, and every management route is refused (direct URLs and APIs)", async () => {
    await as(admin);
    expect((await statusRoute(json(`/api/marketer/leads/${lead1}`, { outreachStatus: "GOT_RESPONSE" }, "PATCH"), ctx({ id: lead1 }))).status).toBe(403);
    expect((await manageList(req("/api/marketer/assignments"), ctx())).status).toBe(403);
    expect((await managePatch(json(`/api/marketer/assignments/${lead1}`, { companyName: "Hacked" }, "PATCH"), ctx({ id: lead1 }))).status).toBe(403);
    expect((await manageDelete(req(`/api/marketer/assignments/${lead1}`, { method: "DELETE" }), ctx({ id: lead1 }))).status).toBe(403);
    await expectRejects(marketer.updateLeadOutreachStatus(session.current!.actor, lead1, { outreachStatus: "GOT_RESPONSE" }), 403);
    const stored = await LeadAssignment.findById(lead1).lean<{ outreachStatus?: string; details?: { companyName?: string } }>();
    expect(stored).toMatchObject({ outreachStatus: "MESSAGED", details: { companyName: "Roles Test One Edited AS" } });
    // Sending is Owner-only too.
    expect((await sendRoute(json("/api/lead-assignments", { companyId: String(new Types.ObjectId()) }), ctx())).status).toBe(403);
  });
});

describe("Digital Marketer: unchanged", () => {
  it("reads the table and sets the outreach status; no management access", async () => {
    const me = await as(dm);
    expect(teamNavigation(me).flatMap((g) => g.items.map((i) => i.href))).not.toContain("/staff/marketer-table");
    expect((await statusRoute(json(`/api/marketer/leads/${lead1}`, { outreachStatus: "GOT_RESPONSE" }, "PATCH"), ctx({ id: lead1 }))).status).toBe(200);
    expect((await manageList(req("/api/marketer/assignments"), ctx())).status).toBe(403);
    expect((await manageDelete(req(`/api/marketer/assignments/${lead1}`, { method: "DELETE" }), ctx({ id: lead1 }))).status).toBe(403);
    // The status a marketer sets is what the Admin and the Owner see.
    expect((await marketer.listMarketerLeads(await as(admin), { q: "Roles Test One" })).items[0]!.outreachStatus).toBe("GOT_RESPONSE");
  });
});

describe("Migration 2026-10-admin-marketer-table-v1", () => {
  it("gives every active Admin read-only table access, recorded and revertable", async () => {
    await SystemSetting.deleteOne({ key: ADMIN_TABLE_MIGRATION_KEY });
    const legacy = await account("ADMIN", []);
    const r = await runAdminMarketerTableMigration();
    expect(r.provisioned.map((p) => p.userId)).toContain(legacy);
    expect(await as(legacy)).toMatchObject({ permissions: expect.arrayContaining(["marketerLeads.view"]) });
    expect(session.current!.actor.permissions).not.toContain("marketerTable.manage");
    const back = await revertPendingHandoffAccess(ADMIN_TABLE_MIGRATION_KEY);
    expect(back.reverted).toBeGreaterThanOrEqual(1);
    expect((await as(legacy)).permissions).not.toContain("marketerLeads.view");
  });
});
