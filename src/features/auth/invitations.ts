import "server-only";
import { z } from "zod";
import { User, Organization, type UserDoc } from "@/models";
import { createOpaqueToken, hashPassword, hashToken } from "@/lib/auth/password";
import { passwordSchema } from "@/lib/validation";
import { Errors } from "@/lib/errors";
import { absoluteUrl } from "@/config/site";
import { getEmailProvider } from "@/lib/email/provider";
import { sendTransactionalEmail } from "@/lib/email/transactional";
import { audit } from "@/lib/audit";

export const authorizedAccounts = [
  { email: "abusiddik9994@gmail.com", role: "OWNER", name: "Owner" },
  { email: "abusiddick84@gmail.com", role: "ADMIN", name: "Super Admin" },
  { email: "careerhelp84@gmail.com", role: "CLIENT", name: "Client" },
] as const;
/** Server-side bootstrap only. There is no public API that accepts an invited role. */
export async function inviteAuthorizedAccounts() {
  if (!getEmailProvider().isLive) throw Errors.badRequest("Configure a live email provider before creating invitations.");
  const results = [];
  for (const account of authorizedAccounts) {
    let user = await User.findOne({ email: account.email }).lean<UserDoc>();
    if (user && !await User.exists({ _id: user._id, passwordHash: { $exists: false } })) {
      results.push({ email: account.email, status: "Existing identity preserved; use normal sign-in/password reset." }); continue;
    }
    const { token, hash } = createOpaqueToken();
    if (!user) {
      const org = account.role === "CLIENT" ? await Organization.create({ name: account.name, slug: "invited-client-" + hash.slice(0, 12), email: account.email, status: "PENDING_APPROVAL" }) : null;
      user = (await User.create({ name: account.name, email: account.email, role: account.role, status: "PENDING_APPROVAL", organizationId: org?._id })).toObject();
    }
    if (!user) throw new Error("Invitation identity could not be created.");
    await User.updateOne({ _id: user._id }, { $set: { invitationTokenHash: hash, invitationExpiresAt: new Date(Date.now() + 86400000) } });
    const mail = await sendTransactionalEmail({ to: account.email, subject: "Set up your ExploreTechify account", sensitive: true, category: "ACCOUNT",
      text: "You have been invited as " + account.name + ". Choose your own password using this single-use link (expires in 24 hours): " + absoluteUrl("/accept-invitation?token=" + token) + ". After setup, sign in with your email and password." });
    await audit(null, "account.invited", { entityType: "User", entityId: String(user._id), metadata: { email: account.email, role: account.role, emailAccepted: mail.accepted } });
    results.push({ email: account.email, status: mail.accepted ? "Invitation accepted by email provider; delivery unconfirmed." : "Invitation saved; email failed. Re-run --invite after fixing email." });
  }
  return results;
}
export async function acceptInvitation(input: unknown) {
  const { token, name, password } = z.object({ token: z.string().min(20).max(200), name: z.string().trim().min(2).max(120), password: passwordSchema }).parse(input);
  const user = await User.findOneAndUpdate({ invitationTokenHash: hashToken(token), invitationExpiresAt: { $gt: new Date() }, status: { $ne: "SUSPENDED" }, passwordHash: { $exists: false } }, {
    $set: { name, passwordHash: await hashPassword(password), emailVerifiedAt: new Date(), status: "ACTIVE" },
    $unset: { invitationTokenHash: 1, invitationExpiresAt: 1 }, $inc: { sessionVersion: 1 },
  }, { new: true }).lean<UserDoc>();
  if (!user) throw Errors.badRequest("This invitation is invalid, expired, or already used.");
  if (user.role === "CLIENT" && user.organizationId) await Organization.updateOne({ _id: user.organizationId, status: "PENDING_APPROVAL" }, { $set: { status: "ACTIVE" } });
  await audit(null, "account.invitation_accepted", { entityType: "User", entityId: String(user._id) });
  return { ok: true };
}
