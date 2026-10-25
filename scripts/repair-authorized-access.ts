import type { UserDoc } from "../src/models";
import { loadEnvConfig } from "@next/env";
import { randomBytes, createCipheriv, createHash, createDecipheriv } from "node:crypto";
import { writeFile } from "node:fs/promises";
loadEnvConfig(process.cwd());
process.env.DISABLE_AUTO_SEED = "true";
process.env.REGISTRY_SCHEDULER = "off";
async function main() {
  if (!process.argv.includes("--apply")) throw new Error("Pass --apply to rotate the two authorized accounts credentials and send security emails.");
  const { connectToDatabase, disconnectFromDatabase } = await import("../src/lib/db/connect");
  const { User } = await import("../src/models");
  const { hashPassword, verifyPassword } = await import("../src/lib/auth/password");
  const { beginLogin } = await import("../src/features/auth/verification");
  const { audit } = await import("../src/lib/audit");
  await connectToDatabase();
  try {
    const accounts = [{ email: "abusiddik9994@gmail.com", role: "OWNER" }, { email: "abusiddick84@gmail.com", role: "ADMIN" }] as const;
    const users = await User.find({ email: { $in: accounts.map(a => a.email) } }).select("+passwordHash +invitationTokenHash +invitationExpiresAt +mfaChallengeHash +authCodeHash +authCodeExpiresAt +authCodePurpose +authCodeAttempts +passwordResetTokenHash +passwordResetExpiresAt").lean();
    if (users.length !== 2) throw new Error("Expected both authorized identities to exist.");
    const secret = process.env.AUTH_SECRET;
    if (!secret || secret.length < 32) throw new Error("Backup encryption secret missing");
    const key = createHash("sha256").update(secret).digest(), iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv), snapshot = JSON.stringify(users);
    const ciphertext = Buffer.concat([cipher.update(snapshot, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const decipher = createDecipheriv("aes-256-gcm", key, iv); decipher.setAuthTag(tag);
    if (Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8") !== snapshot) throw new Error("Backup verification failed");
    await writeFile(".data/account-access/credential-backup-" + Date.now() + ".json", JSON.stringify({ algorithm: "aes-256-gcm", iv: iv.toString("base64"), tag: tag.toString("base64"), ciphertext: ciphertext.toString("base64") }));
    for (const account of accounts) {
      const password = "Et!" + randomBytes(18).toString("base64url");
      const user = await User.findOneAndUpdate({ email: account.email }, {
        $set: { role: account.role, status: "ACTIVE", permissions: [], verificationActivates: false, passwordHash: await hashPassword(password) },
        $inc: { sessionVersion: 1 },
        $unset: { invitationTokenHash: 1, invitationExpiresAt: 1, passwordResetTokenHash: 1, passwordResetExpiresAt: 1, authCodeHash: 1, authCodeExpiresAt: 1, authCodeSentAt: 1, authCodePurpose: 1, mfaChallengeHash: 1 }
      }, { new: true }).select("+passwordHash").lean<UserDoc>();
      if (!user || !await verifyPassword(password, user.passwordHash!)) throw new Error("Password verification failed");
      await audit(null, "account.authorized_credentials_set", { entityType: "User", entityId: String(user._id), metadata: { email: user.email, role: user.role } });
      console.info(JSON.stringify({ email: account.email, role: user.role, status: user.status, password }));
      try { await beginLogin(user); console.info(account.email + ": security email accepted by SMTP provider (inbox delivery unconfirmed)"); }
      catch (err) { console.error(account.email + ": security email failed: " + (err instanceof Error ? err.message : "unknown")); }
    }
  } finally { await disconnectFromDatabase(); }
}
main().catch(err => { console.error(err instanceof Error ? err.message : "Account setup failed"); process.exitCode = 1; });
