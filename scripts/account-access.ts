import { loadEnvConfig } from "@next/env";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";

loadEnvConfig(process.cwd());
process.env.DISABLE_AUTO_SEED = "true";
process.env.REGISTRY_SCHEDULER = "off";
const retained = [
  { email: "abusiddik9994@gmail.com", role: "OWNER" },
  { email: "abusiddick84@gmail.com", role: "ADMIN" },
  { email: "careerhelp84@gmail.com", role: "CLIENT" },
] as const;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  return value;
}

async function main() {
  const { connectToDatabase, disconnectFromDatabase } = await import("../src/lib/db/connect");
  const { User, Organization } = await import("../src/models");
  await connectToDatabase();
  try {
    if (process.argv.includes("--prepare-invitations")) {
      const { authorizedAccounts } = await import("../src/features/auth/invitations");
      for (const account of authorizedAccounts) {
        if (await User.exists({ email: account.email })) { console.info(account.email + ": existing identity preserved"); continue; }
        const org = account.role === "CLIENT" ? await Organization.create({ name: account.name, slug: "authorized-client-" + Date.now(), email: account.email, status: "PENDING_APPROVAL" }) : null;
        await User.create({ email: account.email, name: account.name, role: account.role, status: "PENDING_APPROVAL", organizationId: org?._id });
        console.info(account.email + ": invitation-only identity prepared; no password or verified status assigned");
      }
      const { audit } = await import("../src/lib/audit");
      await audit(null, "accounts.invitation_identities_prepared");
      return;
    }
    if (process.argv.includes("--invite")) {
      const { inviteAuthorizedAccounts } = await import("../src/features/auth/invitations");
      console.info(JSON.stringify(await inviteAuthorizedAccounts(), null, 2));
      return;
    }
    const users = await User.find().select("name email role status organizationId emailVerifiedAt sessionVersion").sort({ email: 1 }).lean();
    const keepEmails = retained.map((x) => x.email);
    const suspend = users.filter((u) => !keepEmails.includes(u.email as never));
    const impacts: { id: string; email: string; role: string; status: string; organizationId: string | null; related: Record<string, number> }[] = [];
    const refs = ["userId", "authorId", "senderId", "assignedTo", "createdBy", "actorId", "accountManagerId", "assignedStaffId", "responses.authorId", "participants.userId", "lastMessageSenderId", "uploadedBy", "completedBy", "requestedBy", "readBy", "reviewedBy", "updatedBy", "submittedBy", "approvedBy", "triggeredBy", "checkedBy", "assignedStaff", "assigneeId", "notes.by", "notes.actorId", "relevanceBy", "lead.relevanceBy", "lead.assignedTo", "eligibility.by", "eligibility.decidedBy", "review.by", "comments.authorId"];
    const collections = await mongoose.connection.db!.listCollections().toArray();
    for (const u of users) {
      const related: Record<string, number> = {};
      await Promise.all(collections.filter((c) => c.name !== "users").map(async (collection) => {
        const filters: Record<string, unknown>[] = refs.map((field) => ({ [field]: { $in: [u._id, String(u._id)] } }));
        if (u.organizationId) filters.push({ organizationId: { $in: [u.organizationId, String(u.organizationId)] } });
        const count = await mongoose.connection.db!.collection(collection.name).countDocuments({ $or: filters });
        if (count) related[collection.name] = count;
      }));
      impacts.push({ id: String(u._id), email: u.email, role: u.role, status: u.status, organizationId: u.organizationId ? String(u.organizationId) : null, related });
    }
    const report = {
      database: mongoose.connection.name, generatedAt: new Date().toISOString(),
      retained: retained.map((r) => ({ ...r, existing: impacts.find((u) => u.email === r.email) || null })),
      suspensionCandidates: impacts.filter((u) => !keepEmails.includes(u.email as never)),
      permanentDeletionList: [],
      retention: "All identities and associated records retained. No permanent deletion is implemented.",
      backupPlan: "Before suspension: encrypted snapshot of users and organizations. Before any future deletion: encrypted full mongodump, restore verification, exact approved identity list and reference reassignment review. Shared organization counts overlap and must not be interpreted as exclusive ownership.",
    };
    await mkdir(".data/account-access", { recursive: true });
    const output = ".data/account-access/impact-report.json";
    if (!process.argv.includes("--apply")) {
      await writeFile(output, JSON.stringify(report, null, 2));
      console.info(JSON.stringify(report, null, 2));
      return;
    }
    const readyOwner = await User.exists({ email: retained[0].email, role: "OWNER", status: "ACTIVE", emailVerifiedAt: { $ne: null }, passwordHash: { $exists: true } });
    if (!readyOwner) throw new Error("The invited Owner must set their password and verify ownership before any existing access can be disabled.");
    const reviewed = JSON.parse(await readFile(output, "utf8"));
    const oldIds = reviewed.suspensionCandidates.map((u: { id: string }) => u.id).sort();
    if (JSON.stringify(canonical(reviewed.suspensionCandidates)) !== JSON.stringify(canonical(report.suspensionCandidates))) throw new Error("Account list changed. Generate and review a fresh report.");
    if (retained.some((r) => !users.some((u) => u.email === r.email))) throw new Error("A retained identity is missing. Use the secure invitation workflow before applying cleanup.");
    const clientIdentity = users.find((u) => u.email === retained[2].email);
    if (!clientIdentity?.organizationId || !await Organization.exists({ _id: clientIdentity.organizationId })) throw new Error("Retained client must have a valid organization before access changes.");
    const secret = process.env.AUTH_SECRET;
    if (!secret || secret.length < 32) throw new Error("AUTH_SECRET (32+ characters) is required for encrypted backup.");
    const key = createHash("sha256").update(secret).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const snapshot = JSON.stringify({ users: await User.find().select("+passwordHash +passwordResetTokenHash +passwordResetExpiresAt +authCodeHash +authCodeExpiresAt +authCodeAttempts +authCodePurpose +mfaChallengeHash +invitationTokenHash +invitationExpiresAt").lean(), organizations: await Organization.find().lean() });
    const ciphertext = Buffer.concat([cipher.update(snapshot, "utf8"), cipher.final()]);
    const backupPath = ".data/account-access/access-backup-" + Date.now() + ".json";
    await writeFile(backupPath, JSON.stringify({ algorithm: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") }), { mode: 0o600 });
    const backup = JSON.parse(await readFile(backupPath, "utf8"));
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(backup.iv, "base64"));
    decipher.setAuthTag(Buffer.from(backup.tag, "base64"));
    const restored = Buffer.concat([decipher.update(Buffer.from(backup.ciphertext, "base64")), decipher.final()]).toString("utf8");
    if (restored !== snapshot) throw new Error("Encrypted account backup verification failed; access was not changed.");
    for (const retainedUser of retained) {
      const identity = users.find((u) => u.email === retainedUser.email)!;
      await User.updateOne({ _id: identity._id }, { $set: { role: retainedUser.role, status: "ACTIVE", permissions: [] }, $inc: { sessionVersion: 1 } });
      if (retainedUser.role === "CLIENT") await Organization.updateOne({ _id: identity.organizationId }, { $set: { status: "ACTIVE" } });
    }
    await User.updateMany({ _id: { $in: suspend.map((u) => u._id) } }, { $set: { status: "SUSPENDED" }, $inc: { sessionVersion: 1 } });
    const { audit } = await import("../src/lib/audit");
    await audit(null, "accounts.access_reconciled", { metadata: { retained: retained.map((r) => r.email), suspendedIds: suspend.map((u) => String(u._id)), backupPath } });
    await writeFile(".data/account-access/applied.json", JSON.stringify({ at: new Date().toISOString(), retained, suspended: oldIds, backupPath, deleted: [] }, null, 2));
    console.info("Access reconciled. Encrypted backup: " + backupPath + ". No accounts or related data deleted.");
  } finally { await disconnectFromDatabase(); }
}
main().catch((err) => { console.error(err instanceof Error ? err.message : "Account access operation failed"); process.exitCode = 1; });
