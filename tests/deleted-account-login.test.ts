import { describe, expect, it } from "vitest";
import { User, Company, DeletedIdentity } from "@/models";
import { authenticate, signupClient } from "@/features/auth/service";
import { deleteUserAccount } from "@/features/users/service";
import { hashPassword } from "@/lib/auth/password";
import { loadSessionUser, toActor } from "@/lib/auth/actor";
import { expectRejects, makeUser } from "./helpers";

const password = "Returning-user-123!";
describe("deleted account authentication", () => {
  for (const role of ["ADMIN", "MANAGER", "STAFF"] as const) {
    it(`returns a deleted ${role} as a fresh Staff identity, including concurrent logins`, async () => {
      const owner = await makeUser("OWNER");
      const { user } = await makeUser(role);
      await User.updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(password) } });
      const oldSession = { sub: String(user._id), role, sv: 0, mf: true };
      expect(await loadSessionUser(oldSession)).toBeTruthy();
      expect((await authenticate({ email: user.email, password })).role).toBe(role);
      const company = await Company.create({ companyName: "Historical record", source: "fixture", sourceId: String(user._id), countryCode: "SG", assignedTo: user._id });
      await deleteUserAccount(owner.actor, String(user._id));
      expect(await User.findById(user._id)).toBeNull();
      expect(await loadSessionUser(oldSession)).toBeNull();
      await expectRejects(authenticate({ email: user.email, password: "wrong" }), 401);
      expect(await User.exists({ email: user.email })).toBeNull();
      const returned = await Promise.all(Array.from({ length: 3 }, () => authenticate({ email: user.email, password })));
      expect(new Set(returned.map((u) => String(u._id))).size).toBe(1);
      const fresh = returned[0];
      expect(String(fresh._id)).not.toBe(String(user._id));
      expect(fresh.role).toBe("STAFF");
      expect(toActor(fresh).permissions).toEqual([]);
      expect(fresh.organizationId).toBeUndefined();
      expect((await Company.findById(company._id))?.assignedTo).toBeUndefined();
      expect((await authenticate({ email: user.email, password }))._id).toEqual(fresh._id);
      expect(await loadSessionUser(oldSession)).toBeNull();
      expect((await loadSessionUser({ sub: String(fresh._id), role: "STAFF", sv: 0, mf: true }))?.actor.permissions).toEqual([]);
      expect(await loadSessionUser({ sub: String(fresh._id), role: "ADMIN", sv: 99, mf: true })).toBeNull();
      expect(await User.countDocuments({ email: user.email })).toBe(1);
      expect((await DeletedIdentity.findOne({ email: user.email }).lean<{ passwordHash?: string }>())?.passwordHash).toBeUndefined();
    });
  }
  it("preserves a suspension even when the account is subsequently deleted", async () => {
    const owner = await makeUser("OWNER");
    const { user } = await makeUser("STAFF", { status: "SUSPENDED" });
    await User.updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(password) } });
    await expectRejects(authenticate({ email: user.email, password }), 401);
    await deleteUserAccount(owner.actor, String(user._id));
    await expectRejects(authenticate({ email: user.email, password }), 401);
    expect(await User.exists({ email: user.email })).toBeNull();
    await signupClient({ name: "Blocked signup", email: user.email, password });
    expect(await User.exists({ email: user.email })).toBeNull();
  });
  it("never retains an older password when a later passwordless identity is deleted", async () => {
    const owner = await makeUser("OWNER");
    const { user } = await makeUser("STAFF");
    await User.updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(password) } });
    await deleteUserAccount(owner.actor, String(user._id));
    const replacement = await User.create({ name: "New invitation", email: user.email, role: "STAFF", status: "PENDING_APPROVAL" });
    await deleteUserAccount(owner.actor, String(replacement._id));
    await expectRejects(authenticate({ email: user.email, password }), 401);
    expect(await User.exists({ email: user.email })).toBeNull();
  });
});
