import { z } from "zod";
import { LANGUAGE_CODES } from "@/config/languages";
import { INDUSTRIES } from "@/config/industries";
import { Organization, User, type UserDoc } from "@/models";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { createOpaqueToken, dummyPasswordCheck, hashPassword, hashToken, verifyPassword } from "@/lib/auth/password";
import { toActor } from "@/lib/auth/actor";
import { emailSchema, isoCountrySchema, optionalPhone, optionalUrl, passwordSchema } from "@/lib/validation";
import { slugify } from "@/lib/utils";
import { absoluteUrl } from "@/config/site";
import { sendTransactionalEmail, transactionalTemplates } from "@/lib/email/transactional";
import { notifyInternal } from "@/features/notifications/service";

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(200) });

/** Returns the user on success. Errors are deliberately generic (no account enumeration). */
export async function authenticate(input: unknown, ip?: string) {
  const { email, password } = loginSchema.parse(input);
  const user = await User.findOne({ email }).select("+passwordHash").lean<UserDoc & { passwordHash: string }>();
  if (!user) {
    await dummyPasswordCheck(password);
    await audit(null, "auth.login_failed", { metadata: { email }, ip });
    throw Errors.unauthorized("Invalid email or password.");
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok || user.status === "SUSPENDED") {
    await audit(null, "auth.login_failed", { entityType: "User", entityId: String(user._id), metadata: { email, suspended: user.status === "SUSPENDED" }, ip });
    throw Errors.unauthorized("Invalid email or password.");
  }
  if (user.role === "CLIENT" && user.organizationId) {
    const org = await Organization.findById(user.organizationId).select("status").lean<{ status: string }>();
    if (!org || org.status === "SUSPENDED") throw Errors.unauthorized("Invalid email or password.");
  }
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
  await audit(toActor(user), "auth.login", { entityType: "User", entityId: String(user._id), ip });
  return user;
}

export const signupSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(120),
  company: z.string().trim().min(2, "Enter your company name").max(200),
  email: emailSchema,
  password: passwordSchema,
  phone: optionalPhone,
  country: isoCountrySchema,
  website: optionalUrl,
  industry: z.enum(INDUSTRIES).optional().or(z.literal("").transform(() => undefined)),
  preferredLanguage: z.enum(LANGUAGE_CODES as [string, ...string[]]).default("en"),
  /** Honeypot — must stay empty. */
  website2: z.string().max(0).optional(),
});

/**
 * Client self-signup. Creates the organization and user in PENDING_APPROVAL
 * with the CLIENT role only — never any privileged access.
 */
export async function signupClient(input: unknown, ip?: string) {
  const data = signupSchema.parse(input);
  if (await User.exists({ email: data.email })) {
    // Same response as success to avoid account enumeration; the owner gets nothing new.
    await audit(null, "auth.signup_duplicate", { metadata: { email: data.email }, ip });
    return { ok: true };
  }
  const org = await Organization.create({
    name: data.company,
    slug: `${slugify(data.company)}-${Math.random().toString(36).slice(2, 7)}`,
    countryCode: data.country,
    website: data.website,
    industry: data.industry,
    phone: data.phone,
    email: data.email,
    preferredLanguage: data.preferredLanguage,
    status: "PENDING_APPROVAL",
  });
  const user = await User.create({
    name: data.name,
    email: data.email,
    passwordHash: await hashPassword(data.password),
    role: "CLIENT",
    status: "PENDING_APPROVAL",
    organizationId: org._id,
    phone: data.phone,
    preferredLanguage: data.preferredLanguage,
  });
  await audit(null, "auth.signup", { entityType: "User", entityId: String(user._id), organizationId: String(org._id), ip });
  await notifyInternal("clients.manage", {
    type: "CLIENT_SIGNUP",
    title: `New client signup: ${data.company}`,
    body: `${data.name} (${data.email}) is awaiting approval.`,
    link: `/dashboard/clients/${org._id}`,
  });
  const userMail = transactionalTemplates.signupReceived(data.name);
  await sendTransactionalEmail({ to: data.email, toName: data.name, ...userMail });
  return { ok: true };
}

export async function requestPasswordReset(input: unknown, ip?: string) {
  const { email } = z.object({ email: emailSchema }).parse(input);
  const user = await User.findOne({ email, status: { $ne: "SUSPENDED" } }).lean<UserDoc>();
  if (!user) return { ok: true };
  const { token, hash } = createOpaqueToken();
  await User.updateOne({ _id: user._id }, { $set: { passwordResetTokenHash: hash, passwordResetExpiresAt: new Date(Date.now() + 3_600_000) } });
  const mail = transactionalTemplates.passwordReset(user.name, absoluteUrl(`/reset-password?token=${token}`));
  await sendTransactionalEmail({ to: user.email, toName: user.name, ...mail });
  await audit(null, "auth.password_reset_requested", { entityType: "User", entityId: String(user._id), ip });
  return { ok: true };
}

export async function resetPassword(input: unknown) {
  const { token, password } = z.object({ token: z.string().min(20).max(200), password: passwordSchema }).parse(input);
  const user = await User.findOne({ passwordResetTokenHash: hashToken(token), passwordResetExpiresAt: { $gt: new Date() } }).lean<UserDoc>();
  if (!user) throw Errors.badRequest("This reset link is invalid or has expired.");
  await User.updateOne(
    { _id: user._id },
    { $set: { passwordHash: await hashPassword(password) }, $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 }, $inc: { sessionVersion: 1 } },
  );
  await audit(toActor(user), "auth.password_reset", { entityType: "User", entityId: String(user._id) });
  return { ok: true };
}

export async function changePassword(userId: string, input: unknown) {
  const { currentPassword, newPassword } = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }).parse(input);
  const user = await User.findById(userId).select("+passwordHash").lean<UserDoc & { passwordHash: string }>();
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) throw Errors.badRequest("Your current password is incorrect.");
  await User.updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(newPassword) } });
  await audit(toActor(user), "auth.password_changed", { entityType: "User", entityId: userId });
}
