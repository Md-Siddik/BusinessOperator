import { beforeAll, describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { ContactRequest, EmailMessage, Organization, User, type UserDoc } from "@/models";
import { acceptInvitation, inviteAuthorizedAccounts } from "@/features/auth/invitations";
import { enforceDurableAuthLimit } from "@/lib/auth/rate-limit";
import { createInternalUser, updateInternalUser, updateOwnProfile, revokeSessions } from "@/features/users/service";
import { authenticate, signupClient } from "@/features/auth/service";
import { beginLogin, consumeAuthCode, hashAuthCode, issueAuthCode, resendVerification } from "@/features/auth/verification";
import { loadSessionUser, isActiveSessionUser } from "@/lib/auth/actor";
import { signSession, verifySession } from "@/lib/auth/token";
import { setEmailProvider, type OutgoingEmail } from "@/lib/email/provider";
import { submitContactRequest } from "@/features/content/service";
import { clientInquiryAction, getInquiry, listInquiries, respondToInquiry, verifyInquiryEmail } from "@/features/inquiries/service";
import { hashToken } from "@/lib/auth/password";
import { expectRejects, makeTenants } from "./helpers";

const sent: OutgoingEmail[] = [];
let failMail = false;
const provider = { id: "test-live", isLive: true, send: async (mail: OutgoingEmail) => {
  if (failMail) throw new Error("Provider refused message");
  sent.push(mail); return { id: "test-" + sent.length };
} };
let t: Awaited<ReturnType<typeof makeTenants>>;
beforeAll(async () => { setEmailProvider(provider); t = await makeTenants(); });
async function setCode(id: unknown, code = "123456", purpose = "VERIFY", expires = Date.now() + 60000) {
  await User.updateOne({ _id: id }, { $set: { authCodeHash: hashAuthCode(code), authCodeExpiresAt: new Date(expires), authCodeAttempts: 0, authCodePurpose: purpose } });
}
describe("Verified onboarding and sessions", () => {
  it("keeps ownership verified across revoked sessions and repeated password logins without sending codes", async () => {
    const email = "repeat-login@example.test";
    const password = "Repeat-login-password-123";
    await signupClient({ name: "Repeat Login", email, password });
    const code = sent.filter((mail) => mail.to === email).at(-1)!.text.match(/code is ([0-9]{6})/)![1];
    await consumeAuthCode({ email, code });
    const verified = await User.findOne({ email }).lean<UserDoc>();
    const before = sent.length;
    for (let i = 0; i < 5; i++) {
      const user = await authenticate({ email, password });
      expect(await beginLogin(user)).toBeNull();
      expect(user.emailVerifiedAt).toEqual(verified!.emailVerifiedAt);
      const payload = { sub: String(user._id), role: user.role, sv: user.sessionVersion ?? 0 };
      const session = await loadSessionUser(await verifySession(await signSession(payload)));
      expect(isActiveSessionUser(session!)).toBe(true);
      await revokeSessions(session!.actor, String(user._id));
      expect(await loadSessionUser(payload)).toBeNull();
    }
    await resendVerification({ email });
    expect(sent).toHaveLength(before);
    expect((await User.findOne({ email }).lean<UserDoc>())!.emailVerifiedAt).toEqual(verified!.emailVerifiedAt);
  });
  it("requires pending registration completion without sending codes during login, for every role", async () => {
    const before = sent.length;
    const pendingUsers = [];
    for (const role of ["CLIENT", "STAFF", "ADMIN", "OWNER"] as const) {
      const user = await User.create({ name: "Unverified", email: `unverified-${role.toLowerCase()}@example.test`, role, status: "ACTIVE" });
      const result = await beginLogin(user.toObject());
      expect(result).toEqual({ registrationRequired: true, email: user.email });
      expect((await User.findById(user._id).select("+authCodePurpose").lean<UserDoc>())?.authCodePurpose).toBeUndefined();
      pendingUsers.push(user);
    }
    expect(sent).toHaveLength(before);
    for (const user of pendingUsers) {
      await resendVerification({ email: user.email });
      const code = sent.at(-1)!.text.match(/code is ([0-9]{6})/)![1];
      await consumeAuthCode({ email: user.email, code });
      expect(await beginLogin((await User.findById(user._id).lean<UserDoc>())!)).toBeNull();
    }
  });
  it("does not let profile updates transfer verified ownership to another email", async () => {
    const before = await User.findById(t.clientA.actor.id).lean<UserDoc>();
    await updateOwnProfile(t.clientA.actor, { email: "replacement@example.test" });
    const after = await User.findById(t.clientA.actor.id).lean<UserDoc>();
    expect(after!.email).toBe(before!.email);
    expect(after!.emailVerifiedAt).toEqual(before!.emailVerifiedAt);
  });
  it("uses only name/email/password, then activates after a single-use email code", async () => {
    await signupClient({ name: "Minimal Client", email: "minimal@example.test", password: "Secure-password-123" });
    const user = await User.findOne({ email: "minimal@example.test" }).lean<UserDoc>();
    expect(user?.role).toBe("CLIENT");
    const payload = { sub: String(user!._id), role: "CLIENT" as const, sv: 0 };
    expect(isActiveSessionUser((await loadSessionUser(payload))!)).toBe(false);
    const mail = sent.find((x) => x.to === user!.email)!;
    const code = mail.text.match(/code is ([0-9]{6})/)![1];
    expect((await EmailMessage.findOne({ to: user!.email }).lean<{ body: string }>())?.body).toBe("[Security message redacted]");
    await consumeAuthCode({ email: user!.email, code });
    expect(isActiveSessionUser((await loadSessionUser(payload))!)).toBe(true);
    expect((await Organization.findById(user!.organizationId).lean<{ status: string }>())?.status).toBe("ACTIVE");
    await expectRejects(consumeAuthCode({ email: user!.email, code }), 400);
    await signupClient({ name: "Duplicate", email: user!.email, password: "Secure-password-123" });
    expect(await User.countDocuments({ email: user!.email })).toBe(1);
  });
  it("rejects expired codes and locks out after five failed guesses", async () => {
    const user = await User.create({ name: "Code limits", email: "code-limits@example.test", role: "CLIENT" });
    await setCode(user._id, "123456", "VERIFY", Date.now() - 1);
    await expectRejects(consumeAuthCode({ email: user.email, code: "123456" }), 400);
    await setCode(user._id);
    for (let i = 0; i < 5; i++) await expectRejects(consumeAuthCode({ email: user.email, code: "000000" }), 400);
    await expectRejects(consumeAuthCode({ email: user.email, code: "123456" }), 400);
  });
  it("allows only one concurrent consumer", async () => {
    const user = await User.create({ name: "Concurrent code", email: "concurrent-code@example.test", role: "CLIENT" });
    await setCode(user._id);
    const results = await Promise.allSettled([consumeAuthCode({ email: user.email, code: "123456" }), consumeAuthCode({ email: user.email, code: "123456" })]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  });
  it("allows verified owner/admin password sessions without role-based OTP and rejects stale ownership codes", async () => {
    const before = sent.length;
    for (const user of [t.owner.user, t.admin.user]) {
      expect(await beginLogin(user.toObject())).toBeNull();
      const payload = { sub: String(user._id), role: user.role, sv: user.sessionVersion ?? 0 };
      expect(await loadSessionUser(await verifySession(await signSession(payload)))).toBeTruthy();
    }
    await setCode(t.owner.actor.id);
    await expectRejects(consumeAuthCode({ email: t.owner.actor.email, code: "123456" }), 400);
    await resendVerification({ email: t.owner.actor.email });
    expect(sent).toHaveLength(before);
  });
  it("resends MFA only with its password-authenticated challenge", async () => {
    const user = await User.create({ name: "MFA resend", email: "mfa-resend@example.test", role: "ADMIN", status: "ACTIVE" });
    // Legacy/explicit challenges are separate from normal login, which never creates one.
    const challenge = "explicit-security-challenge-token-123456";
    await User.updateOne({ _id: user._id }, { $set: { mfaChallengeHash: hashToken(challenge) } });
    await issueAuthCode(user, "MFA");
    await expectRejects(resendVerification({ email: user.email, challenge }), 429);
    await User.updateOne({ _id: user._id }, { $unset: { authCodeSentAt: 1 } });
    const before = sent.length;
    await resendVerification({ email: user.email, challenge: "wrong-challenge-token-123456" });
    expect(sent).toHaveLength(before);
    await resendVerification({ email: user.email, challenge });
    const code = sent.at(-1)!.text.match(/code is ([0-9]{6})/)![1];
    await consumeAuthCode({ email: user.email, challenge, code });
  });
  it("reports email failure and permits retry without leaving a cooldown lock", async () => {
    const user = await User.create({ name: "Retry mail", email: "mail-retry@example.test", role: "CLIENT", status: "PENDING_APPROVAL" });
    failMail = true;
    try { await expectRejects(resendVerification({ email: user.email }), 400); }
    finally { failMail = false; }
    expect(await User.exists({ _id: user._id, authCodeSentAt: { $exists: true } })).toBeNull();
    await resendVerification({ email: user.email });
    expect(sent.at(-1)?.to).toBe(user.email);
  });
  it("persists valid signed sessions and rejects revocation and organization suspension", async () => {
    const payload = { sub: t.clientB.actor.id, role: "CLIENT" as const, sv: 0 };
    const jwt = await signSession(payload);
    expect(await loadSessionUser(await verifySession(jwt))).toBeTruthy();
    await User.updateOne({ _id: t.clientB.actor.id }, { $inc: { sessionVersion: 1 } });
    expect(await loadSessionUser(await verifySession(jwt))).toBeNull();
    await User.updateOne({ _id: t.clientB.actor.id }, { $set: { sessionVersion: 0 } });
    await Organization.updateOne({ _id: t.orgB._id }, { $set: { status: "SUSPENDED" } });
    expect(await loadSessionUser(payload)).toBeNull();
    await Organization.updateOne({ _id: t.orgB._id }, { $set: { status: "ACTIVE" } });
  });
  it("does not accept simulated email as verification", async () => {
    setEmailProvider({ ...provider, isLive: false });
    await expectRejects(issueAuthCode(t.clientA.user, "VERIFY"), 400);
    setEmailProvider(provider);
  });
});
describe("Inquiry ownership and quotations", () => {
  let id: string;
  it("saves public inquiries once and requires email ownership confirmation", async () => {
    const input = { name: "Public Client", email: t.clientA.actor.email, message: "Please build a business website.", need: "website", budget: "medium" };
    await submitContactRequest(input);
    await submitContactRequest(input);
    expect(await ContactRequest.countDocuments({ email: input.email })).toBe(1);
    const inquiry = await ContactRequest.findOne({ email: input.email }).lean<{ _id: Types.ObjectId }>();
    id = String(inquiry!._id);
    await expectRejects(respondToInquiry(t.owner.actor, id, { kind: "REPLY", body: "Private response" }), 400);
    const verification = sent.find((m) => m.subject === "Verify your project inquiry email")!.text;
    const token = verification.match(/token=([A-Za-z0-9_-]+)/)![1];
    await verifyInquiryEmail({ id, token });
    await expectRejects(verifyInquiryEmail({ id, token }), 400);
    expect((await getInquiry(t.clientA.actor, id)).emailVerifiedAt).toBeTruthy();
  });
  it("isolates client data and denies STAFF management", async () => {
    await expectRejects(getInquiry(t.clientB.actor, id), 404);
    expect((await listInquiries(t.clientB.actor)).items).toHaveLength(0);
    await expectRejects(respondToInquiry(t.clientA.actor, id, { kind: "REPLY", body: "No" }), 403);
    await expectRejects(respondToInquiry(t.staff.actor, id, { kind: "REPLY", body: "No" }), 403);
  });
  it("saves owner replies and admin quotations; clients can decide once", async () => {
    expect((await respondToInquiry(t.owner.actor, id, { kind: "REPLY", body: "Thank you for your inquiry." })).emailAccepted).toBe(true);
    await respondToInquiry(t.admin.actor, id, { kind: "QUOTATION", body: "Proposal", amount: 1200, currency: "USD", scope: "Five pages", delivery: "Two weeks", paymentTerms: "50% deposit", notes: "Includes setup" });
    const r = await getInquiry(t.clientA.actor, id);
    const quote = r.responses.find((x) => x.kind === "QUOTATION")!;
    await expectRejects(clientInquiryAction(t.clientB.actor, id, { responseId: String(quote._id), decision: "ACCEPTED" }), 404);
    await clientInquiryAction(t.clientA.actor, id, { responseId: String(quote._id), decision: "ACCEPTED" });
    await expectRejects(clientInquiryAction(t.clientA.actor, id, { responseId: String(quote._id), decision: "REJECTED" }), 409);
    expect((await getInquiry(t.clientA.actor, id)).status).toBe("ACCEPTED");
  });
  it("preserves responses and reports email provider errors truthfully", async () => {
    failMail = true;
    const result = await respondToInquiry(t.owner.actor, id, { kind: "REPLY", body: "A saved response despite provider failure." });
    failMail = false;
    expect(result).toEqual({ saved: true, emailAccepted: false });
    expect((await getInquiry(t.owner.actor, id)).responses.at(-1)?.emailStatus).toBe("FAILED");
    await clientInquiryAction(t.clientA.actor, id, { body: "Thanks for the update." });
    expect((await getInquiry(t.clientA.actor, id)).responses.at(-1)?.kind).toBe("CLIENT_REPLY");
  });
  it("rejects expired inquiry links", async () => {
    const r = await ContactRequest.create({ name: "Expired", email: "expired@example.test", message: "An expired link test", verificationTokenHash: hashToken("a".repeat(32)), verificationExpiresAt: new Date(Date.now() - 1) });
    await expectRejects(verifyInquiryEmail({ id: String(r._id), token: "a".repeat(32) }), 400);
    await expectRejects(getInquiry(t.clientA.actor, String(new Types.ObjectId())), 404);
  });
});


describe("Invitations, delegated administration, and shared rate limits", () => {
  it("creates passwordless pending identities and consumes invitation tokens once", async () => {
    await inviteAuthorizedAccounts();
    const owner = await User.findOne({ email: "abusiddik9994@gmail.com" }).select("+passwordHash").lean<UserDoc>();
    expect(owner?.passwordHash).toBeUndefined();
    expect(owner?.status).toBe("PENDING_APPROVAL");
    const text = sent.find((m) => m.to === "abusiddik9994@gmail.com")!.text;
    const token = text.match(/token=([A-Za-z0-9_-]+)/)![1];
    await acceptInvitation({ token, name: "Invited Owner", password: "Strong-invited-password-123" });
    const activated = await User.findById(owner!._id).lean<UserDoc>();
    expect(activated?.status).toBe("ACTIVE");
    expect(activated?.emailVerifiedAt).toBeTruthy();
    expect(await beginLogin(activated!)).toBeNull();
    await expectRejects(acceptInvitation({ token, name: "Replay", password: "Strong-invited-password-123" }), 400);
  });
  it("lets Super Admin manage STAFF while preventing privileged-role escalation or revocation", async () => {
    const created = await createInternalUser(t.admin.actor, { name: "Delegated staff", email: "delegated-staff@example.test", role: "STAFF", password: "Strong-staff-password-123" });
    await updateInternalUser(t.admin.actor, created.id, { status: "SUSPENDED" });
    await expectRejects(createInternalUser(t.admin.actor, { name: "Illegal admin", email: "illegal-admin@example.test", role: "ADMIN", password: "Strong-staff-password-123" }), 403);
    await expectRejects(updateInternalUser(t.admin.actor, created.id, { role: "OWNER" }), 403);
    await expectRejects(revokeSessions(t.admin.actor, t.owner.actor.id), 403);
    await expectRejects(revokeSessions(t.clientA.actor, t.owner.actor.id), 403);
  });
  it("shares a durable request budget across calls", async () => {
    const rule = { bucket: "security-test", limit: 2, windowMs: 60000 };
    await enforceDurableAuthLimit(rule, "isolated-test-ip");
    await enforceDurableAuthLimit(rule, "isolated-test-ip");
    await expectRejects(enforceDurableAuthLimit(rule, "isolated-test-ip"), 429);
  });
  it("limits session renewal to thirty days from initial authentication", async () => {
    const old = Math.floor(Date.now() / 1000) - 31 * 86400;
    const jwt = await signSession({ sub: t.owner.actor.id, role: "OWNER", sv: 0, mf: true, st: old });
    expect(await verifySession(jwt)).toBeNull();
  });
});
