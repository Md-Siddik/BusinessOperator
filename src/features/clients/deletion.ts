import "server-only";
import { createHash } from "node:crypto";
import { type ClientSession } from "mongoose";
import { z } from "zod";
import { AuditLog, ClientDeletion, ClientDocument, ClientService, Company, Conversation, Organization, Project, ProjectTask, SupportTicket, User, type ClientDeletionDoc, type OrganizationDoc, type UserDoc } from "@/models";
import { can, type Actor } from "@/lib/permissions";
import { toActor } from "@/lib/auth/actor";
import { createOpaqueToken, hashToken } from "@/lib/auth/password";
import { Errors } from "@/lib/errors";
import { parseObjectId } from "@/lib/validation";
import { clientTransaction } from "./transaction";

export function canDeleteClient(actor: Actor) {
  return (actor.role === "OWNER" || actor.role === "ADMIN") && can(actor, "clients.manage");
}
async function authorize(actor: Actor, session?: ClientSession) {
  if (!canDeleteClient(actor)) throw Errors.forbidden();
  const current = await User.findOne({ _id: parseObjectId(actor.id), status: "ACTIVE" }).session(session ?? null).lean<UserDoc>();
  if (!current || !canDeleteClient(toActor(current))) throw Errors.forbidden();
}

async function snapshot(id: string, actor: Actor, session?: ClientSession) {
  const org = await Organization.findById(parseObjectId(id)).session(session ?? null).lean<OrganizationDoc>();
  if (!org) throw Errors.notFound("Client not found");
  const filter = { organizationId: parseObjectId(id) };
  // Deterministic identifiers/versions detect changed identities, counts, roles and related records.
  const users = await User.find(filter).select("name email role status organizationId sessionVersion permissions permissionGrants updatedAt").sort({ _id: 1 }).session(session ?? null).lean<UserDoc[]>();
  const related: Record<string, unknown[]> = {};
  for (const [label, model] of Object.entries({ services: ClientService, projects: Project, tickets: SupportTicket, documents: ClientDocument, conversations: Conversation })) {
    related[label] = await (model as typeof ClientService).find(filter).select("_id updatedAt").sort({ _id: 1 }).session(session ?? null).lean();
  }
  const projectIds = related.projects.map((p) => (p as { _id: unknown })._id);
  related.tasks = await ProjectTask.find({ projectId: { $in: projectIds } }).select("_id updatedAt").sort({ _id: 1 }).session(session ?? null).lean();
  related.companyLinks = await Company.find({ "lead.organizationId": org._id }).select("_id updatedAt").sort({ _id: 1 }).session(session ?? null).lean();
  const current = await User.findById(actor.id).select("role status permissions permissionGrants sessionVersion").session(session ?? null).lean();
  const fingerprint = createHash("sha256").update(JSON.stringify({ org, users, related, current })).digest("hex");
  return { org, fingerprint, identity: { id: String(org._id), name: org.name, email: org.email ?? null, company: org.name, status: org.status, users: users.map((u) => ({ id: String(u._id), name: u.name, email: u.email, role: u.role, status: u.status })) }, impact: { ...Object.fromEntries(Object.entries(related).map(([key, rows]) => [key, rows.length])), users: users.length, historyRetained: true, accessRevoked: true } };
}

const tokenSchema = z.string().min(40).max(100);
export async function beginClientDeletion(actor: Actor, id: string) {
  await authorize(actor);
  const review = await snapshot(id, actor);
  const { token, hash } = createOpaqueToken();
  await ClientDeletion.create({ tokenHash: hash, actorId: actor.id, organizationId: id, fingerprint: review.fingerprint, phase: "IDENTITY", expiresAt: new Date(Date.now() + 10 * 60_000) });
  return { token, identity: review.identity, step: 1 as const };
}

export async function advanceClientDeletion(actor: Actor, id: string, input: unknown) {
  await authorize(actor);
  const body = z.discriminatedUnion("action", [
    z.object({ action: z.literal("review"), token: tokenSchema }).strict(),
    z.object({ action: z.literal("acknowledge"), token: tokenSchema, acknowledged: z.literal(true) }).strict(),
    z.object({ action: z.literal("cancel"), token: tokenSchema }).strict(),
  ]).parse(input);
  const key = { tokenHash: hashToken(body.token), actorId: actor.id, organizationId: parseObjectId(id), expiresAt: { $gt: new Date() } };
  if (body.action === "cancel") {
    await ClientDeletion.updateOne({ ...key, phase: { $in: ["IDENTITY", "IMPACT", "FINAL"] } }, { $set: { phase: "CANCELLED" } });
    return { cancelled: true as const };
  }
  const phase = body.action === "review" ? "IDENTITY" : "IMPACT";
  const confirmation = await ClientDeletion.findOne({ ...key, phase }).lean<ClientDeletionDoc>();
  if (!confirmation) throw Errors.conflict("Complete the confirmation steps in order, or restart the deletion review.");
  const review = await snapshot(id, actor);
  if (review.fingerprint !== confirmation.fingerprint) throw Errors.conflict("Client, related records or permissions changed. Restart the deletion review.");
  const result = await ClientDeletion.updateOne({ ...key, phase }, { $set: { phase: body.action === "review" ? "IMPACT" : "FINAL" } });
  if (!result.modifiedCount) throw Errors.conflict("Confirmation changed. Restart the deletion review.");
  return { identity: review.identity, impact: review.impact, step: body.action === "review" ? 2 as const : 3 as const };
}

export async function deleteClient(actor: Actor, id: string, input: unknown) {
  const body = z.object({ token: tokenSchema, confirmId: z.string(), acknowledged: z.literal(true) }).strict().parse(input);
  if (body.confirmId !== id) throw Errors.badRequest("Type the exact selected Client ID.");
  const objectId = parseObjectId(id);
  return clientTransaction(async (session) => {
    await authorize(actor, session);
    const confirmation = await ClientDeletion.findOne({ tokenHash: hashToken(body.token), actorId: actor.id, organizationId: objectId, phase: "FINAL", expiresAt: { $gt: new Date() } }).session(session).lean<ClientDeletionDoc>();
    if (!confirmation) throw Errors.conflict("Complete all three deletion confirmation steps before deleting this client.");
    const review = await snapshot(id, actor, session);
    if (review.fingerprint !== confirmation.fingerprint) throw Errors.conflict("Client, related records or permissions changed. Restart the deletion review.");
    const consumed = await ClientDeletion.updateOne({ tokenHash: hashToken(body.token), phase: "FINAL" }, { $set: { phase: "CONSUMED" } }, { session });
    if (!consumed.modifiedCount) throw Errors.conflict("This confirmation has already been used.");
    // The tombstone preserves reference integrity; all historical work is kept.
    await Organization.updateOne({ _id: objectId }, { $set: { name: "Deleted client", slug: `deleted-${id}`, status: "SUSPENDED", deletedAt: new Date(), deletedBy: actor.id }, $unset: { email: 1, phone: 1, address: 1, website: 1, notes: 1, industry: 1, countryCode: 1, accountManagerId: 1, companyId: 1 }, $inc: { lifecycleVersion: 1 } }, { session });
    await User.updateMany({ organizationId: objectId, role: "CLIENT" }, { $set: { status: "SUSPENDED" }, $inc: { sessionVersion: 1 }, $unset: { invitationTokenHash: 1, invitationExpiresAt: 1, passwordResetTokenHash: 1, passwordResetExpiresAt: 1, authCodeHash: 1, authCodeExpiresAt: 1, mfaChallengeHash: 1 } }, { session });
    await Company.updateMany({ "lead.organizationId": objectId }, { $unset: { "lead.organizationId": 1 } }, { session });
    // Fail closed if the audit cannot be committed with deletion. No client PII in metadata.
    await AuditLog.create([{ actorId: actor.id, actorEmail: actor.email, actorRole: actor.role, action: "client.deleted", entityType: "Organization", entityId: id, organizationId: objectId, metadata: { policy: "RETAIN_HISTORY_TOMBSTONE", impact: review.impact, confirmationSteps: 3 } }], { session });
    return { ok: true, id, historyRetained: true };
  });
}
