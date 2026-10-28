import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { AuditLog, Company, LeadAssignment, Organization, SystemSetting, User, type UserDoc } from "@/models";
import { loadSessionUser, type SessionUser } from "@/lib/auth/actor";
import { applyRolePreview } from "@/lib/auth/preview";
import { createOpaqueToken } from "@/lib/auth/password";
import { DIGITAL_MARKETER_HANDOFF_PERMISSIONS, ROLE_TEMPLATES, effectivePermissions, type Role } from "@/lib/permissions";
import { teamNavigation } from "@/lib/permissions/navigation";
import type { SessionPayload } from "@/lib/auth/token";
import { expectRejects, makeOrg, makeUser } from "./helpers";

/**
 * The shared Digital Marketer table (Send to Marketer), invitation acceptance, the table migration
 * and its revert, and the Owner role preview's audit trail. Isolated test fixtures only.
 */
const session = vi.hoisted(() => ({ current: null as SessionUser | null, payload: null as SessionPayload | null }));
vi.mock("@/lib/auth/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/session")>()),
  getSessionUser: async () => session.current,
  getSessionPayload: async () => session.payload,
  getActor: async () => session.current?.actor ?? null,
}));

const marketer = await import("@/features/marketer/service");
const { acceptInvitation } = await import("@/features/auth/invitations");
const { runMarketerTableMigration, revertPendingHandoffAccess, HANDOFF_MIGRATION_KEY } = await import("@/features/marketer/handoff-migration");
const { GET: marketerLeadsRoute } = await import("@/app/api/marketer/leads/route");
const { PATCH: statusRoute } = await import("@/app/api/marketer/leads/[id]/route");
const { POST: sendRoute } = await import("@/app/api/lead-assignments/route");
const { GET: companyIntelRoute } = await import("@/app/api/company-intel/route");

const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(new URL(url, "http://localhost:3000"), init);
const json = (url: string, body: unknown, method = "POST") => req(url, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const ctx = <P extends object>(params: P = {} as P) => ({ params: Promise.resolve(params) });

async function signIn(id: unknown, previewRole?: Role) {
  const u = await User.findById(id).lean<UserDoc>();
  const payload: SessionPayload = { sub: String(u!._id), role: u!.role as Role, sv: u!.sessionVersion ?? 0, mf: true };
  session.payload = payload;
  session.current = await applyRolePreview(await loadSessionUser(payload), payload, previewRole ? { sub: payload.sub, sv: payload.sv, role: previewRole } : null);
  return session.current!;
}
const fresh = async (id: unknown) => (await signIn(id)).actor;
let n = 0;
async function company(name: string) {
  return Company.create({ companyName: name, countryCode: "NO", source: "fixture", sourceId: `prov-${++n}`, registrationNumber: `99${n}000000`, contactPerson: { name: "Contact Person" }, phone: "+47 22 00 00 00" });
}
async function invited(role: Role, opts: { expired?: boolean; organizationId?: unknown } = {}) {
  const { token, hash } = createOpaqueToken();
  const u = await User.create({ name: `Invited ${role}`, email: `invite-${role.toLowerCase()}-${++n}@test.local`, role, status: "PENDING_APPROVAL", organizationId: opts.organizationId, invitationTokenHash: hash, invitationExpiresAt: new Date(Date.now() + (opts.expired ? -60_000 : 86_400_000)) });
  return { id: String(u._id), token };
}

/** A Digital Marketer holding "View Marketer Table" as a recorded Owner grant (how real accounts hold it). */
async function marketerWithTable() {
  const m = await makeUser("DIGITAL_MARKETER", { permissions: [] });
  await User.updateOne({ _id: m.user._id }, { $set: { permissions: ["marketerLeads.view"], permissionGrants: [{ permission: "marketerLeads.view", grantedBy: owner.user._id, grantedByRole: "OWNER", origin: "OWNER", grantedAt: new Date() }] } });
  return m;
}

let owner: Awaited<ReturnType<typeof makeUser>>;
beforeAll(async () => {
  owner = await makeUser("OWNER");
});

describe("Send to Marketer: one shared table for every Digital Marketer", () => {
  it("the table permission is scoped to the marketer table only — never administrative", () => {
    expect(DIGITAL_MARKETER_HANDOFF_PERMISSIONS).toEqual(["marketerLeads.view"]);
    expect(ROLE_TEMPLATES.DIGITAL_MARKETER).toEqual(["marketerLeads.view"]);
    for (const p of ["users.manage", "companies.delete", "settings.manage", "leads.sendToMarketer", "audit.view"] as const) expect(effectivePermissions("DIGITAL_MARKETER", [], [{ permission: p }])).not.toContain(p);
    // Only Digital Marketers can hold it.
    for (const role of ["ADMIN", "MANAGER", "STAFF", "CLIENT"] as const) expect(effectivePermissions(role, [], [{ permission: "marketerLeads.view" }])).toEqual([]);
  });

  it("one click adds the company to the table; every marketer with the permission sees it and can work it", async () => {
    const a = await marketerWithTable();
    const b = await marketerWithTable();
    const c = await company("Shared Table AS");
    await signIn(owner.user._id);
    const res = await sendRoute(json("/api/lead-assignments", { companyId: String(c._id) }), ctx());
    expect(res.status).toBe(200);
    const sent = (await res.json()) as { status: string; viewers: number };
    expect(sent.status).toBe("sent");
    expect(sent.viewers).toBeGreaterThanOrEqual(2);
    expect(await LeadAssignment.findOne({ companyId: c._id }).lean<{ recipientId: unknown }>()).toMatchObject({ recipientId: null });

    for (const m of [a, b]) {
      const me = await signIn(m.user._id);
      expect(teamNavigation(me.actor).flatMap((g) => g.items.map((i) => i.href))).toContain("/staff/client-leads");
      const list = await marketerLeadsRoute(req("/api/marketer/leads"), ctx());
      expect(list.status).toBe(200);
      expect(((await list.json()) as { items: { companyName: string }[] }).items.map((i) => i.companyName)).toContain("Shared Table AS");
    }
    // The outreach status is shared: B sees what A set.
    await signIn(a.user._id);
    const row = (await marketer.listMarketerLeads(await fresh(a.user._id), { q: "Shared Table" })).items[0]!;
    expect((await statusRoute(json(`/api/marketer/leads/${row.id}`, { outreachStatus: "MESSAGED" }, "PATCH"), ctx({ id: row.id }))).status).toBe(200);
    expect((await marketer.listMarketerLeads(await fresh(b.user._id), { q: "Shared Table" })).items[0]).toMatchObject({ id: row.id, outreachStatus: "MESSAGED" });
    // …and nothing outside the table: no Company Intelligence, no Owner APIs.
    expect((await companyIntelRoute(req("/api/company-intel"), ctx())).status).toBe(403);
    expect((await sendRoute(json("/api/lead-assignments", { companyId: String(c._id) }), ctx())).status).toBe(403);
  });

  it("sending never grants access; a marketer without the permission sees nothing", async () => {
    const none = await makeUser("DIGITAL_MARKETER", { permissions: [] });
    await User.updateOne({ _id: none.user._id }, { $set: { permissionGrants: [], permissions: [] } });
    const c = await company("No Access AS");
    await marketer.sendLeadToMarketer(await fresh(owner.user._id), String(c._id));
    const me = await signIn(none.user._id);
    expect(me.actor.permissions).toEqual([]);
    expect((await marketerLeadsRoute(req("/api/marketer/leads"), ctx())).status).toBe(403);
    // Other roles never see the table either.
    for (const role of ["ADMIN", "STAFF"] as const) {
      const u = await makeUser(role);
      await signIn(u.user._id);
      expect((await marketerLeadsRoute(req("/api/marketer/leads"), ctx())).status).toBe(403);
    }
  });

  it("a repeated send keeps one row; a withdrawn lead leaves the table and can't be edited by marketers", async () => {
    const m = await marketerWithTable();
    const c = await company("Repeat Co AS");
    const o = await fresh(owner.user._id);
    const first = await marketer.sendLeadToMarketer(o, String(c._id));
    expect(await marketer.sendLeadToMarketer(o, String(c._id))).toMatchObject({ status: "already", assignmentId: first.assignmentId });
    expect(await LeadAssignment.countDocuments({ companyId: c._id })).toBe(1);
    await marketer.withdrawLeadAssignment(o, first.assignmentId);
    expect((await marketer.listMarketerLeads(await fresh(m.user._id), { q: "Repeat Co" })).total).toBe(0);
    await signIn(m.user._id);
    expect((await statusRoute(json(`/api/marketer/leads/${first.assignmentId}`, { outreachStatus: "MESSAGED" }, "PATCH"), ctx({ id: first.assignmentId }))).status).toBe(404);
  });
});

describe("Invitation acceptance", () => {
  it("activates an invited Digital Marketer with the role template recorded as grants; login works", async () => {
    const inv = await invited("DIGITAL_MARKETER");
    expect(await acceptInvitation({ token: inv.token, name: "Ingrid Marketer", password: "Strong-test-password-1" })).toEqual({ ok: true });
    const u = await User.findById(inv.id).lean<UserDoc & { permissionGrants: { permission: string; via?: string }[] }>();
    expect(u).toMatchObject({ status: "ACTIVE", role: "DIGITAL_MARKETER" });
    expect(u!.permissionGrants.map((g) => [g.permission, g.via])).toEqual([["marketerLeads.view", "invitation"]]);
    const me = await signIn(inv.id);
    expect(me.actor.permissions).toEqual(["marketerLeads.view"]);
    expect(me.actor.role).toBe("DIGITAL_MARKETER");
  });

  it("uses the Owner's saved role template, limited to what the role may hold", async () => {
    await SystemSetting.updateOne({ key: "access.roleTemplates" }, { $set: { "value.DIGITAL_MARKETER": ["marketerLeads.view", "companies.read", "users.manage"] } }, { upsert: true });
    const inv = await invited("DIGITAL_MARKETER");
    await acceptInvitation({ token: inv.token, name: "Template Marketer", password: "Strong-test-password-1" });
    const me = await signIn(inv.id);
    expect([...me.actor.permissions].sort()).toEqual(["companies.read", "marketerLeads.view"]);
    await SystemSetting.updateOne({ key: "access.roleTemplates" }, { $unset: { "value.DIGITAL_MARKETER": 1 } });
  });

  it("rejects expired, reused and unknown invitations", async () => {
    const expired = await invited("DIGITAL_MARKETER", { expired: true });
    await expectRejects(acceptInvitation({ token: expired.token, name: "Late Person", password: "Strong-test-password-1" }), 400);
    expect((await User.findById(expired.id).lean<UserDoc>())!.status).toBe("PENDING_APPROVAL");
    const once = await invited("STAFF");
    await acceptInvitation({ token: once.token, name: "Once Person", password: "Strong-test-password-1" });
    await expectRejects(acceptInvitation({ token: once.token, name: "Twice Person", password: "Strong-test-password-1" }), 400);
    await expectRejects(acceptInvitation({ token: "x".repeat(43), name: "Nobody Here", password: "Strong-test-password-1" }), 400);
  });

  it("a client invitation never receives team permissions and stays in its own organization", async () => {
    const org = await makeOrg("Invited Client AS", "PENDING_APPROVAL");
    const other = await makeOrg("Other Client AS");
    const inv = await invited("CLIENT", { organizationId: org._id });
    await acceptInvitation({ token: inv.token, name: "Client Person", password: "Strong-test-password-1" });
    const me = await signIn(inv.id);
    expect(me.actor.permissions).toEqual([]);
    expect(me.actor.organizationId).toBe(String(org._id));
    expect(me.actor.organizationId).not.toBe(String(other._id));
    expect((await Organization.findById(org._id).lean<{ status: string }>())!.status).toBe("ACTIVE");
  });
});

describe("Migration 2026-10-marketer-table-v1", () => {
  it("merges per-marketer rows into one table row, gives every marketer the table, and reverts exactly that", async () => {
    await LeadAssignment.deleteMany({});
    await SystemSetting.deleteOne({ key: HANDOFF_MIGRATION_KEY });
    const m1 = await makeUser("DIGITAL_MARKETER", { permissions: [] });
    const m2 = await makeUser("DIGITAL_MARKETER", { permissions: [] });
    await User.updateMany({ _id: { $in: [m1.user._id, m2.user._id] } }, { $set: { permissionGrants: [], permissions: [] } });
    const c = await company("Legacy Lead AS");
    const old = new Date("2026-10-20T08:00:00Z");
    const base = { companyId: c._id, senderId: owner.user._id, countryCode: "NO", sentAt: old, history: [{ action: "SENT", actorId: owner.user._id, at: old }] };
    const r1 = await LeadAssignment.create({ ...base, recipientId: m1.user._id, status: "ACTIVE" });
    const r2 = await LeadAssignment.create({ ...base, recipientId: m2.user._id, status: "WITHDRAWN", outreachStatus: "GOT_RESPONSE", outreachStatusAt: new Date("2026-10-25T08:00:00Z"), outreachStatusBy: m2.user._id });

    const r = await runMarketerTableMigration();
    expect(r.merged).toHaveLength(1);
    const rows = await LeadAssignment.find({ companyId: c._id }).lean<{ _id: Types.ObjectId; recipientId: unknown; status: string; outreachStatus?: string; mergedInto?: Types.ObjectId; formerRecipientId?: Types.ObjectId }[]>();
    const table = rows.filter((x) => x.recipientId === null);
    expect(table).toHaveLength(1);
    // The most recently worked row is kept; it is active (one row was active) with the latest outreach status.
    expect(table[0]).toMatchObject({ status: "ACTIVE", outreachStatus: "GOT_RESPONSE" });
    const other = rows.find((x) => x.recipientId !== null)!;
    expect(other).toMatchObject({ status: "WITHDRAWN" });
    expect(String(other.mergedInto)).toBe(String(table[0]!._id));
    // Every active marketer can open the table now.
    expect((await fresh(m1.user._id)).permissions).toEqual(["marketerLeads.view"]);
    expect((await fresh(m2.user._id)).permissions).toEqual(["marketerLeads.view"]);
    expect((await marketer.listMarketerLeads(await fresh(m1.user._id), {})).items.map((i) => i.companyName)).toEqual(["Legacy Lead AS"]);
    // Idempotent.
    const again = await runMarketerTableMigration();
    expect(again.merged).toHaveLength(0);
    expect(again.provisioned).toHaveLength(0);

    const back = await revertPendingHandoffAccess();
    expect(back).toMatchObject({ merges: 1 });
    expect((await fresh(m1.user._id)).permissions).toEqual([]);
    const restored = await LeadAssignment.find({ companyId: c._id }).lean<{ _id: Types.ObjectId; recipientId: Types.ObjectId | null; status: string }[]>();
    expect(restored.map((x) => [String(x._id), String(x.recipientId), x.status]).sort()).toEqual([[String(r1._id), String(m1.user._id), "ACTIVE"], [String(r2._id), String(m2.user._id), "WITHDRAWN"]].sort());
  });
});

describe("Owner role preview: audit trail and no false denials", () => {
  it("every blocked write is audited against the Owner; the previewed workflow reads work without 403s", async () => {
    await signIn(owner.user._id, "DIGITAL_MARKETER");
    expect(session.current!.preview).toMatchObject({ role: "DIGITAL_MARKETER", realRole: "OWNER" });
    // The marketer workflow opens with the same shared table a Digital Marketer sees (the role template holds the table permission).
    const list = await marketerLeadsRoute(req("/api/marketer/leads"), ctx());
    expect(list.status).toBe(200);
    const asMarketer = (await list.json()) as { total: number };
    expect(asMarketer.total).toBe(await LeadAssignment.countDocuments({ recipientId: null, status: "ACTIVE" }));
    const id = String(new Types.ObjectId());
    const res = await statusRoute(json(`/api/marketer/leads/${id}`, { outreachStatus: "MESSAGED" }, "PATCH"), ctx({ id }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("PREVIEW_READ_ONLY");
    const log = await AuditLog.findOne({ action: "role_preview.write_blocked" }).sort({ createdAt: -1 }).lean<{ actorId: unknown; actorRole: string; metadata: Record<string, unknown> }>();
    expect(String(log!.actorId)).toBe(String(owner.user._id));
    expect(log!.actorRole).toBe("OWNER");
    expect(log!.metadata).toMatchObject({ previewRole: "DIGITAL_MARKETER", method: "PATCH", path: `/api/marketer/leads/${id}` });
  });
});
