import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { AuditLog, ClientDeletion, ClientService, Company, Organization, Project, User } from "@/models";
import { createClientUser, createOrganization, getOrganizationOverview, listOrganizations } from "@/features/clients/service";
import { advanceClientDeletion, beginClientDeletion, deleteClient } from "@/features/clients/deletion";
import { deleteUserAccount } from "@/features/users/service";
import { authenticate } from "@/features/auth/service";
import { acceptInvitation } from "@/features/auth/invitations";
import { hashPassword } from "@/lib/auth/password";
import { loadSessionUser, toActor, type SessionUser } from "@/lib/auth/actor";
import { expectRejects, makeUser } from "./helpers";

const mail = vi.hoisted(() => ({ send: vi.fn(async () => ({ accepted: true })) }));
vi.mock("@/lib/email/transactional", () => ({ sendTransactionalEmail: mail.send, transactionalTemplates: {} }));
const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => session.user }));
const { DELETE } = await import("@/app/api/clients/[id]/route");
const { POST: confirmationRoute } = await import("@/app/api/clients/[id]/deletion/route");
const password = "Client-lifecycle-123!";
let owner: Awaited<ReturnType<typeof makeUser>>;
beforeAll(async () => { owner = await makeUser("OWNER"); });
const client = (name = "Client A") => createOrganization(owner.actor, { name, email: "client-a@example.test" });
async function confirmed(id: string) {
  const start = await beginClientDeletion(owner.actor, id);
  await advanceClientDeletion(owner.actor, id, { action: "review", token: start.token });
  await advanceClientDeletion(owner.actor, id, { action: "acknowledge", token: start.token, acknowledged: true });
  return { token: start.token, confirmId: id, acknowledged: true };
}

describe("repeated client-user lifecycle", () => {
  it("invites, activates and deletes users repeatedly without changing the client or restoring old credentials", async () => {
    const { id } = await client();
    const before = await Organization.findById(id).lean<{ name: string; email: string }>();
    const ids = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const result = await createClientUser(owner.actor, id, { name: "Client contact", email: "repeat@example.test" });
      ids.add(result.id);
      const outgoing = mail.send.mock.calls.at(-1) as unknown as [{ text: string }];
      const token = new URL(outgoing[0].text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;
      await acceptInvitation({ token, name: "Client contact", password });
      const loggedIn = await authenticate({ email: "repeat@example.test", password });
      expect(loggedIn.role).toBe("CLIENT");
      expect(toActor(loggedIn).permissions).toEqual([]);
      expect((await getOrganizationOverview(owner.actor, id)).users).toHaveLength(1);
      await deleteUserAccount(owner.actor, result.id);
      expect((await getOrganizationOverview(owner.actor, id)).users).toHaveLength(0);
      expect(await Organization.findById(id)).toMatchObject({ name: before!.name, email: before!.email });
      expect(await loadSessionUser({ sub: result.id, role: "CLIENT", sv: loggedIn.sessionVersion, mf: true })).toBeNull();
    }
    expect(ids.size).toBe(3);
    const fresh = await createClientUser(owner.actor, id, { name: "Client contact", email: "repeat@example.test" });
    await expectRejects(authenticate({ email: "repeat@example.test", password }), 401);
    expect(await User.findById(fresh.id)).toMatchObject({ role: "CLIENT", organizationId: new Types.ObjectId(id) });
  });
  it("explicitly links only eligible accounts and preserves existing credentials", async () => {
    const { id } = await client("Association");
    const staff = await makeUser("STAFF", { permissions: [] });
    await User.updateOne({ _id: staff.user._id }, { $set: { passwordHash: await hashPassword(password), permissionGrants: [] } });
    expect(await createClientUser(owner.actor, id, { mode: "link", name: staff.user.name, email: staff.user.email })).toMatchObject({ id: String(staff.user._id), linked: true });
    expect((await authenticate({ email: staff.user.email, password })).role).toBe("CLIENT");
    const privileged = await makeUser("ADMIN");
    await expectRejects(createClientUser(owner.actor, id, { mode: "link", name: privileged.user.name, email: privileged.user.email }), 409);
    await expectRejects(createClientUser(owner.actor, id, { mode: "link", name: staff.user.name, email: staff.user.email }), 409);
    const suspended = await makeUser("STAFF", { status: "SUSPENDED", permissions: [] });
    await expectRejects(createClientUser(owner.actor, id, { mode: "link", name: suspended.user.name, email: suspended.user.email }), 409);
  });
  it("deduplicates concurrent invitations and permits retry after email rejection", async () => {
    const { id } = await client("Concurrency");
    const data = { name: "Concurrent contact", email: "concurrent@example.test" };
    const results = await Promise.allSettled([createClientUser(owner.actor, id, data), createClientUser(owner.actor, id, data)]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(await User.countDocuments({ email: data.email })).toBe(1);
    mail.send.mockResolvedValueOnce({ accepted: false });
    await expectRejects(createClientUser(owner.actor, id, { name: "Retry contact", email: "retry@example.test" }), 400);
    await createClientUser(owner.actor, id, { name: "Retry contact", email: "retry@example.test" });
    expect(await User.countDocuments({ email: "retry@example.test" })).toBe(1);
  });
});

describe("three-step client deletion", () => {
  it("retains history, revokes linked access, releases creation references and never reuses client IDs", async () => {
    const { id } = await client();
    const user = await makeUser("CLIENT", { organizationId: id });
    const unrelated = await makeUser("STAFF");
    const other = await client("Unrelated client");
    const untouched = JSON.stringify(await User.findById(unrelated.user._id).lean());
    const company = await Company.create({ companyName: "Source company", countryCode: "SG", source: "fixture", sourceId: "client-history", lead: { organizationId: id, stage: "CLIENT" } });
    const project = await Project.create({ organizationId: id, name: "Historical project", status: "ACTIVE" });
    await ClientService.create({ organizationId: id, category: "web-development", name: "Historical service", status: "ACTIVE" });
    const body = await confirmed(id);
    expect(await deleteClient(owner.actor, id, body)).toMatchObject({ ok: true, historyRetained: true });
    expect(await Organization.findById(id)).toBeNull();
    expect(await Organization.collection.findOne({ _id: new Types.ObjectId(id) })).toMatchObject({ name: "Deleted client", deletedBy: owner.user._id });
    expect(await Organization.collection.findOne({ _id: new Types.ObjectId(id) })).not.toHaveProperty("email");
    expect(await Project.findById(project._id)).toMatchObject({ organizationId: new Types.ObjectId(id) });
    expect(await ClientService.countDocuments({ organizationId: id })).toBe(1);
    expect((await Company.findById(company._id))?.lead?.organizationId).toBeUndefined();
    expect(await loadSessionUser({ sub: String(user.user._id), role: "CLIENT", sv: 0, mf: true })).toBeNull();
    expect(await User.findById(user.user._id)).toMatchObject({ status: "SUSPENDED", sessionVersion: 1 });
    expect(JSON.stringify(await User.findById(unrelated.user._id).lean())).toBe(untouched);
    expect(await Organization.findById(other.id)).toBeTruthy();
    const log = await AuditLog.findOne({ action: "client.deleted", entityId: id }).lean<{ metadata: { confirmationSteps: number }; actorId: Types.ObjectId }>();
    expect(log).toMatchObject({ actorId: owner.user._id, metadata: { confirmationSteps: 3 } });
    expect(JSON.stringify(log)).not.toContain("client-a@example.test");
    expect((await listOrganizations(owner.actor, {})).items.some((o) => String(o._id) === id)).toBe(false);
    await expectRejects(deleteClient(owner.actor, id, body), 409);
    const recreated = await client();
    expect(recreated.id).not.toBe(id);
    await createClientUser(owner.actor, recreated.id, { name: "Recreated contact", email: "recreated@example.test" });
  });
  it("enforces every server step, exact ID, actor binding and authorization", async () => {
    const { id } = await client("Mandatory steps");
    const start = await beginClientDeletion(owner.actor, id);
    await expectRejects(deleteClient(owner.actor, id, { token: start.token, confirmId: id, acknowledged: true }), 409);
    await expectRejects(advanceClientDeletion(owner.actor, id, { action: "acknowledge", token: start.token, acknowledged: true }), 409);
    await advanceClientDeletion(owner.actor, id, { action: "review", token: start.token });
    await expectRejects(advanceClientDeletion(owner.actor, id, { action: "acknowledge", token: start.token, acknowledged: false }), 400);
    await advanceClientDeletion(owner.actor, id, { action: "acknowledge", token: start.token, acknowledged: true });
    await expectRejects(deleteClient(owner.actor, id, { token: start.token, confirmId: String(new Types.ObjectId()), acknowledged: true }), 400);
    const otherOwner = await makeUser("OWNER");
    await expectRejects(deleteClient(otherOwner.actor, id, { token: start.token, confirmId: id, acknowledged: true }), 409);
    const staff = await makeUser("STAFF");
    await expectRejects(beginClientDeletion(staff.actor, id), 403);
    await expectRejects(deleteClient(staff.actor, id, { token: start.token, confirmId: id, acknowledged: true }), 403);
    expect(await Organization.findById(id)).toBeTruthy();
  });
  for (const step of [1, 2, 3]) it(`cancels at step ${step} and makes the token unusable`, async () => {
    const { id } = await client(`Cancel ${step}`);
    const start = await beginClientDeletion(owner.actor, id);
    if (step >= 2) await advanceClientDeletion(owner.actor, id, { action: "review", token: start.token });
    if (step >= 3) await advanceClientDeletion(owner.actor, id, { action: "acknowledge", token: start.token, acknowledged: true });
    await advanceClientDeletion(owner.actor, id, { action: "cancel", token: start.token });
    await expectRejects(deleteClient(owner.actor, id, { token: start.token, confirmId: id, acknowledged: true }), 409);
    expect(await Organization.findById(id)).toBeTruthy();
  });
  it("rejects expired confirmations, stale data, changed related records and revoked permissions", async () => {
    const { id } = await client("Stale review");
    let body = await confirmed(id);
    await Organization.updateOne({ _id: id }, { $set: { name: "Changed name" } });
    await expectRejects(deleteClient(owner.actor, id, body), 409);
    body = await confirmed(id);
    await Project.create({ organizationId: id, name: "New related work", status: "ACTIVE" });
    await expectRejects(deleteClient(owner.actor, id, body), 409);
    body = await confirmed(id);
    await ClientDeletion.updateMany({ organizationId: id }, { $set: { expiresAt: new Date(0) } });
    await expectRejects(deleteClient(owner.actor, id, body), 409);
    const admin = await makeUser("ADMIN", { permissions: ["clients.manage"] });
    const start = await beginClientDeletion(admin.actor, id);
    await User.updateOne({ _id: admin.user._id }, { $set: { permissionGrants: [], permissions: [] } });
    await expectRejects(advanceClientDeletion(admin.actor, id, { action: "review", token: start.token }), 403);
  });
  it("does not expose an API deletion shortcut or leak data to clients", async () => {
    const { id } = await client("API steps");
    session.user = { ...owner.actor, status: "ACTIVE", emailVerifiedAt: new Date(), actor: owner.actor };
    const request = (url: string, body: unknown, method = "POST") => new NextRequest(`http://localhost:3000${url}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const context = { params: Promise.resolve({ id }) };
    expect((await DELETE(request(`/api/clients/${id}`, { confirmId: id, acknowledged: true }, "DELETE"), context)).status).toBe(400);
    const start = await (await confirmationRoute(request(`/api/clients/${id}/deletion`, { action: "start" }), context)).json();
    expect(start.step).toBe(1);
    expect((await DELETE(request(`/api/clients/${id}`, { token: start.token, confirmId: id, acknowledged: true }, "DELETE"), context)).status).toBe(409);
    const clientUser = await makeUser("CLIENT", { organizationId: id });
    session.user = { ...clientUser.actor, status: "ACTIVE", emailVerifiedAt: new Date(), organizationId: id, organizationStatus: "ACTIVE", actor: clientUser.actor };
    expect((await confirmationRoute(request(`/api/clients/${id}/deletion`, { action: "start" }), context)).status).toBe(403);
  });
  it("commits exactly once for concurrent final submissions", async () => {
    const { id } = await client("Concurrent deletion");
    const body = await confirmed(id);
    const outcomes = await Promise.allSettled([deleteClient(owner.actor, id, body), deleteClient(owner.actor, id, body)]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await AuditLog.countDocuments({ action: "client.deleted", entityId: id })).toBe(1);
  });
  it("rolls back deletion, access revocation and token consumption if auditing fails", async () => {
    const { id } = await client("Rollback");
    const linked = await makeUser("CLIENT", { organizationId: id });
    const body = await confirmed(id);
    const fail = vi.spyOn(AuditLog, "create").mockRejectedValueOnce(new Error("Audit storage unavailable"));
    try { await expect(deleteClient(owner.actor, id, body)).rejects.toThrow("Audit storage unavailable"); }
    finally { fail.mockRestore(); }
    expect(await Organization.findById(id)).toMatchObject({ name: "Rollback" });
    expect(await User.findById(linked.user._id)).toMatchObject({ status: "ACTIVE", sessionVersion: 0 });
    expect(await ClientDeletion.findOne({ organizationId: id, phase: "FINAL" })).toBeTruthy();
    await deleteClient(owner.actor, id, body);
  });
});
