import "server-only";
import { createHmac, randomInt } from "node:crypto";
import { z } from "zod";
import { ContactRequest, User, Organization, type UserDoc } from "@/models";
import { hashToken } from "@/lib/auth/password";
import { emailSchema } from "@/lib/validation";
import { Errors } from "@/lib/errors";
import { sendTransactionalEmail } from "@/lib/email/transactional";
import { getEmailProvider } from "@/lib/email/provider";

export function hashAuthCode(code: string) {
  const key = process.env.AUTH_SECRET;
  if (!key || key.length < 32) throw new Error("AUTH_SECRET (32+ characters) is required for verification.");
  return createHmac("sha256", key).update(code).digest("hex");
}

export async function issueAuthCode(user: Pick<UserDoc, "_id" | "email" | "name">, purpose: "VERIFY" | "MFA") {
  if (!getEmailProvider().isLive) throw Errors.badRequest("Email verification is unavailable. Configure a live email provider.");
  const code = String(randomInt(100000, 1000000));
  const hash = hashAuthCode(code);
  const locked = await User.updateOne({
    _id: user._id,
    $or: [{ authCodeSentAt: { $exists: false } }, { authCodeSentAt: { $lt: new Date(Date.now() - 60_000) } }],
  }, { $set: { authCodeHash: hash, authCodeExpiresAt: new Date(Date.now() + 600_000), authCodeSentAt: new Date(), authCodeAttempts: 0, authCodePurpose: purpose } });
  if (!locked.modifiedCount) throw Errors.tooManyRequests("Please wait 60 seconds before requesting another code.");
  const result = await sendTransactionalEmail({ to: user.email, toName: user.name, sensitive: true, subject: purpose === "MFA" ? "Your sign-in security code" : "Verify your email", text: "Your security code is " + code + ". It expires in 10 minutes. Do not share this code. If you did not request it, ignore this email." });
  if (!result.accepted) {
    await User.updateOne({ _id: user._id, authCodeHash: hash }, { $unset: { authCodeHash: 1, authCodeExpiresAt: 1, authCodeSentAt: 1, authCodePurpose: 1 } });
    throw Errors.badRequest("The email provider did not confirm acceptance. Please retry later.");
  }
}

export async function resendVerification(input: unknown) {
  const { email, challenge } = z.object({ email: emailSchema, challenge: z.string().min(20).max(200).optional() }).parse(input);
  const filter = challenge
    ? { email, role: { $in: ["OWNER", "ADMIN"] }, mfaChallengeHash: hashToken(challenge), status: { $ne: "SUSPENDED" } }
    : { email, emailVerifiedAt: null, status: { $ne: "SUSPENDED" } };
  const user = await User.findOne(filter).lean<UserDoc>();
  if (user) await issueAuthCode(user, challenge ? "MFA" : "VERIFY");
  return { ok: true };
}

export async function consumeAuthCode(input: unknown) {
  const { email, code, challenge } = z.object({ email: emailSchema, code: z.string().regex(/^[0-9]{6}$/), challenge: z.string().min(20).max(200).optional() }).parse(input);
  const purpose = challenge ? "MFA" : "VERIFY";
  const user = await User.findOneAndUpdate({
    email, status: { $ne: "SUSPENDED" }, authCodePurpose: purpose, ...(purpose === "VERIFY" ? { emailVerifiedAt: null } : {}),
    authCodeExpiresAt: { $gt: new Date() }, authCodeAttempts: { $lt: 5 },
    ...(challenge ? { mfaChallengeHash: hashToken(challenge) } : {}),
  }, { $inc: { authCodeAttempts: 1 } }, { new: true }).select("+authCodeHash").lean<UserDoc>();
  if (!user || user.authCodeHash !== hashAuthCode(code)) throw Errors.badRequest("Invalid or expired code. Request a new code.");
  const consumed = await User.updateOne({ _id: user._id, email: user.email, role: user.role, authCodeHash: user.authCodeHash, authCodePurpose: purpose, authCodeExpiresAt: { $gt: new Date() }, authCodeAttempts: { $lte: 5 }, status: { $ne: "SUSPENDED" } }, {
    $set: { emailVerifiedAt: user.emailVerifiedAt ?? new Date(), ...(user.verificationActivates ? { status: "ACTIVE", verificationActivates: false } : {}) },
    $unset: { authCodeHash: 1, authCodeExpiresAt: 1, authCodePurpose: 1, mfaChallengeHash: 1 },
  });
  if (!consumed.modifiedCount) throw Errors.badRequest("This code has already been used.");
  if (user.verificationActivates && user.organizationId) await Organization.updateOne({ _id: user.organizationId, status: "PENDING_APPROVAL" }, { $set: { status: "ACTIVE" } });
  await ContactRequest.updateMany({ email: user.email, userId: null }, { $set: { userId: user._id, emailVerifiedAt: new Date() } });
  return user;
}

export async function beginLogin(user: UserDoc) {
  // Login never issues codes. Unfinished registration is resumed separately,
  // using the original registration code or an explicit, rate-limited resend.
  if (!user.emailVerifiedAt) {
    return { registrationRequired: true, email: user.email };
  }
  return null;
}
