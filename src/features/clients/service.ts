import { Types, type FilterQuery } from "mongoose";
import { z } from "zod";
import { getServiceCategory, SERVICE_SLUGS } from "@/config/services";
import { CLIENT_SERVICE_STATUSES, DOCUMENT_CATEGORIES, OPEN_TICKET_STATUSES } from "@/lib/constants";
import {
  AuditLog,
  type AuditLogDoc,
  ClientDocument,
  ClientService,
  Conversation,
  Organization,
  Project,
  SupportTicket,
  User,
  type ClientDocumentDoc,
  type ClientServiceDoc,
  type ConversationDoc,
  type OrganizationDoc,
  type ProjectDoc,
  type SupportTicketDoc,
  type UserDoc,
} from "@/models";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { can, isClient, isInternal, type Actor } from "@/lib/permissions";
import { createOpaqueToken, hashPassword } from "@/lib/auth/password";
import { escapeRegex } from "@/lib/utils";
import { emailSchema, objectId, optionalPhone, optionalUrl, paginate, parseObjectId } from "@/lib/validation";
import { absoluteUrl } from "@/config/site";
import { getStorage, type ValidatedUpload } from "@/lib/storage";
import { sendTransactionalEmail, transactionalTemplates } from "@/lib/email/transactional";
import { notifyInternal, notifyUsers } from "@/features/notifications/service";
import { getBaseMessages } from "@/lib/i18n/dictionaries";
import { getPath } from "@/lib/i18n/translator";

/** Organization access: clients only their own; internal users any (read). */
export function assertOrgAccess(actor: Actor, organizationId: string | Types.ObjectId) {
  if (isInternal(actor)) return;
  if (isClient(actor) && actor.organizationId && actor.organizationId === String(organizationId)) return;
  throw Errors.notFound();
}

function requireClientsManage(actor: Actor) {
  if (!can(actor, "clients.manage")) throw Errors.forbidden();
}

export async function listOrganizations(actor: Actor, opts: { q?: string; status?: string; page?: number }) {
  if (!isInternal(actor)) throw Errors.forbidden();
  const page = opts.page ?? 1;
  const filter: FilterQuery<OrganizationDoc> = {};
  if (opts.status) filter.status = opts.status;
  if (opts.q) filter.name = new RegExp(escapeRegex(opts.q), "i");
  const [items, total] = await Promise.all([
    Organization.find(filter).sort({ status: 1, createdAt: -1 }).skip((page - 1) * 25).limit(25).populate("accountManagerId", "name").lean<OrganizationDoc[]>(),
    Organization.countDocuments(filter),
  ]);
  const ids = items.map((o) => o._id);
  const [services, tickets, users] = await Promise.all([
    ClientService.aggregate([{ $match: { organizationId: { $in: ids }, status: "ACTIVE" } }, { $group: { _id: "$organizationId", n: { $sum: 1 } } }]),
    SupportTicket.aggregate([{ $match: { organizationId: { $in: ids }, status: { $in: OPEN_TICKET_STATUSES } } }, { $group: { _id: "$organizationId", n: { $sum: 1 } } }]),
    User.aggregate([{ $match: { organizationId: { $in: ids } } }, { $group: { _id: "$organizationId", n: { $sum: 1 } } }]),
  ]);
  const m = (rows: { _id: Types.ObjectId; n: number }[]) => new Map(rows.map((r) => [String(r._id), r.n]));
  const [sm, tm, um] = [m(services), m(tickets), m(users)];
  return paginate(
    items.map((o) => ({ ...o, activeServices: sm.get(String(o._id)) ?? 0, openTickets: tm.get(String(o._id)) ?? 0, userCount: um.get(String(o._id)) ?? 0 })),
    total,
    page,
    25,
  );
}

export async function getOrganizationOverview(actor: Actor, organizationId: string) {
  const id = parseObjectId(organizationId);
  assertOrgAccess(actor, id);
  const org = await Organization.findById(id).populate("accountManagerId", "name email").lean<OrganizationDoc>();
  if (!org) throw Errors.notFound();
  const docFilter: FilterQuery<ClientDocumentDoc> = { organizationId: id, ...(isClient(actor) && { visibleToClient: true }) };
  const [users, services, projects, tickets, documents, conversations] = await Promise.all([
    User.find({ organizationId: id }).select("name email status role phone lastLoginAt preferredLanguage").lean<UserDoc[]>(),
    ClientService.find({ organizationId: id }).sort({ status: 1, createdAt: -1 }).lean<ClientServiceDoc[]>(),
    Project.find({ organizationId: id }).sort({ updatedAt: -1 }).limit(10).lean<ProjectDoc[]>(),
    SupportTicket.find({ organizationId: id }).sort({ updatedAt: -1 }).limit(10).select("-comments").lean<SupportTicketDoc[]>(),
    ClientDocument.find(docFilter).sort({ createdAt: -1 }).limit(50).lean<ClientDocumentDoc[]>(),
    Conversation.find({ organizationId: id }).sort({ lastMessageAt: -1 }).limit(5).lean<ConversationDoc[]>(),
  ]);
  return { org, users, services, projects, tickets, documents, conversations };
}

export const organizationUpdateSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  website: optionalUrl,
  phone: optionalPhone,
  industry: z.string().max(40).optional(),
  address: z.string().trim().max(300).optional(),
  preferredLanguage: z.string().max(5).optional(),
  notes: z.string().trim().max(5000).optional(),
  accountManagerId: objectId.optional().nullable(),
});

export async function updateOrganization(actor: Actor, organizationId: string, input: unknown) {
  const id = parseObjectId(organizationId);
  assertOrgAccess(actor, id);
  let data = organizationUpdateSchema.parse(input);
  if (isClient(actor)) {
    // Clients may maintain their own profile basics only.
    data = { name: data.name, website: data.website, phone: data.phone, address: data.address, preferredLanguage: data.preferredLanguage } as typeof data;
  } else {
    requireClientsManage(actor);
  }
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  await Organization.updateOne({ _id: id }, { $set: clean });
  await audit(actor, "client.updated", { entityType: "Organization", entityId: organizationId, organizationId, metadata: { fields: Object.keys(clean) } });
}

export async function setOrganizationStatus(actor: Actor, organizationId: string, status: "ACTIVE" | "SUSPENDED") {
  requireClientsManage(actor);
  const id = parseObjectId(organizationId);
  const org = await Organization.findById(id).lean<OrganizationDoc>();
  if (!org) throw Errors.notFound();
  const wasPending = org.status === "PENDING_APPROVAL";
  await Organization.updateOne({ _id: id }, { $set: { status } });
  if (status === "ACTIVE") {
    const pending = await User.find({ organizationId: id, status: "PENDING_APPROVAL" }).lean<UserDoc[]>();
    await User.updateMany({ organizationId: id, status: "PENDING_APPROVAL" }, { $set: { status: "ACTIVE" } });
    for (const u of pending) {
      await sendTransactionalEmail({ to: u.email, toName: u.name, ...transactionalTemplates.accountApproved(u.name) });
      await notifyUsers([String(u._id)], { type: "ACCOUNT", title: "Your workspace is ready", link: "/portal" });
    }
  } else {
    // Suspension revokes sessions of every user in the organization.
    await User.updateMany({ organizationId: id }, { $inc: { sessionVersion: 1 } });
  }
  await audit(actor, wasPending && status === "ACTIVE" ? "client.approved" : status === "ACTIVE" ? "client.reactivated" : "client.suspended", {
    entityType: "Organization",
    entityId: organizationId,
    organizationId,
  });
}

export const createClientUserSchema = z.object({ name: z.string().trim().min(2).max(120), email: emailSchema, phone: optionalPhone });

/** Internal staff add a user to a client org; the user sets a password via an emailed link. */
export async function createClientUser(actor: Actor, organizationId: string, input: unknown) {
  requireClientsManage(actor);
  const id = parseObjectId(organizationId);
  const org = await Organization.findById(id).lean<OrganizationDoc>();
  if (!org) throw Errors.notFound();
  const data = createClientUserSchema.parse(input);
  if (await User.exists({ email: data.email })) throw Errors.conflict("A user with this email already exists.");
  const { token, hash } = createOpaqueToken();
  const user = await User.create({
    ...data,
    passwordHash: await hashPassword(createOpaqueToken().token),
    role: "CLIENT",
    status: org.status === "ACTIVE" ? "ACTIVE" : "PENDING_APPROVAL",
    organizationId: id,
    preferredLanguage: org.preferredLanguage,
    passwordResetTokenHash: hash,
    passwordResetExpiresAt: new Date(Date.now() + 7 * 86_400_000),
  });
  await sendTransactionalEmail({
    to: data.email,
    toName: data.name,
    subject: `You've been invited to ${org.name}'s workspace`,
    text: `Hi ${data.name},\n\nYou now have access to ${org.name}'s ExploreTechify workspace. Set your password here (valid for 7 days):\n${absoluteUrl(`/reset-password?token=${token}`)}`,
  });
  await audit(actor, "user.created", { entityType: "User", entityId: String(user._id), organizationId, metadata: { role: "CLIENT" } });
  return { id: String(user._id) };
}

/* ───────────── Client services ───────────── */

export const clientServiceSchema = z.object({
  category: z.enum(SERVICE_SLUGS as [string, ...string[]]),
  itemKey: z.string().max(60).optional(),
  name: z.string().trim().min(2).max(120),
  status: z.enum(CLIENT_SERVICE_STATUSES).default("ACTIVE"),
  notes: z.string().trim().max(2000).optional(),
});

export async function listClientServices(actor: Actor, organizationId: string) {
  assertOrgAccess(actor, organizationId);
  return ClientService.find({ organizationId: parseObjectId(organizationId) }).sort({ status: 1, createdAt: -1 }).lean<ClientServiceDoc[]>();
}

export async function upsertClientService(actor: Actor, organizationId: string, serviceId: string | null, input: unknown) {
  requireClientsManage(actor);
  const data = clientServiceSchema.parse(input);
  const orgId = parseObjectId(organizationId);
  const set = {
    ...data,
    ...(data.status === "ACTIVE" && { startedAt: new Date() }),
    ...(data.status === "COMPLETED" && { completedAt: new Date() }),
  };
  if (serviceId) {
    const res = await ClientService.updateOne({ _id: parseObjectId(serviceId), organizationId: orgId }, { $set: set });
    if (!res.matchedCount) throw Errors.notFound();
  } else {
    await ClientService.create({ ...set, organizationId: orgId });
  }
  await audit(actor, "client.service_updated", { entityType: "ClientService", organizationId, metadata: data });
}

/** Clients request a new service — recorded as REQUESTED and routed to the team. */
export async function requestClientService(actor: Actor, input: unknown) {
  if (!isClient(actor) || !actor.organizationId) throw Errors.forbidden();
  const data = z.object({ category: z.enum(SERVICE_SLUGS as [string, ...string[]]), notes: z.string().trim().max(2000).optional() }).parse(input);
  const category = getServiceCategory(data.category)!;
  const org = await Organization.findById(actor.organizationId).select("name").lean<{ name: string }>();
  const name = (getPath(getBaseMessages("en"), `services.categories.${category.key}.name`) as string | undefined) ?? data.category;
  await ClientService.create({ organizationId: actor.organizationId, category: data.category, name, status: "REQUESTED", notes: data.notes, requestedBy: actor.id });
  await notifyInternal("clients.manage", { type: "CLIENT_REQUEST", title: `${org?.name ?? "A client"} requested a service`, body: data.notes, link: `/dashboard/clients/${actor.organizationId}` });
  await audit(actor, "client.service_requested", { entityType: "ClientService", organizationId: actor.organizationId, metadata: { category: data.category } });
}

/* ───────────── Documents ───────────── */

export async function listDocuments(actor: Actor, organizationId: string) {
  assertOrgAccess(actor, organizationId);
  const filter: FilterQuery<ClientDocumentDoc> = { organizationId: parseObjectId(organizationId) };
  if (isClient(actor)) filter.visibleToClient = true;
  return ClientDocument.find(filter).sort({ createdAt: -1 }).populate("uploadedBy", "name").lean();
}

export async function uploadDocument(actor: Actor, organizationId: string, file: ValidatedUpload, meta: { category?: string; visibleToClient?: boolean }) {
  assertOrgAccess(actor, organizationId);
  if (isInternal(actor)) requireClientsManage(actor);
  const category = (DOCUMENT_CATEGORIES as readonly string[]).includes(meta.category ?? "") ? meta.category : "OTHER";
  const fileKey = await getStorage().save(file.data, file.name);
  const doc = await ClientDocument.create({
    organizationId: parseObjectId(organizationId),
    name: file.name,
    category,
    fileKey,
    mimeType: file.mimeType,
    size: file.size,
    visibleToClient: isClient(actor) ? true : meta.visibleToClient !== false,
    uploadedBy: actor.id,
  });
  await audit(actor, "document.uploaded", { entityType: "ClientDocument", entityId: String(doc._id), organizationId });
  if (isClient(actor)) await notifyInternal("clients.manage", { type: "CLIENT_REQUEST", title: `New document from a client: ${file.name}`, link: `/dashboard/clients/${organizationId}` });
  return doc.toObject();
}

/** Authorized document download — organization access and client visibility are enforced. */
export async function getDocumentForDownload(actor: Actor, documentId: string) {
  const doc = await ClientDocument.findById(parseObjectId(documentId)).lean<ClientDocumentDoc>();
  if (!doc) throw Errors.notFound();
  assertOrgAccess(actor, doc.organizationId);
  if (isClient(actor) && !doc.visibleToClient) throw Errors.notFound();
  const data = await getStorage().read(doc.fileKey);
  await audit(actor, "document.downloaded", { entityType: "ClientDocument", entityId: documentId, organizationId: String(doc.organizationId) });
  return { doc, data };
}

/* ───────────── Activity ───────────── */

const CLIENT_VISIBLE_ACTIONS = [
  "client.approved",
  "client.service_updated",
  "client.service_requested",
  "document.uploaded",
  "ticket.created",
  "ticket.status_changed",
  "project.created",
  "project.updated",
  "chat.conversation_started",
];

export async function getOrganizationActivity(actor: Actor, organizationId: string, limit = 20) {
  assertOrgAccess(actor, organizationId);
  const filter: Record<string, unknown> = { organizationId: parseObjectId(organizationId) };
  if (isClient(actor)) filter.action = { $in: CLIENT_VISIBLE_ACTIONS };
  return AuditLog.find(filter).sort({ createdAt: -1 }).limit(limit).select("action actorEmail actorRole createdAt metadata entityType").lean<AuditLogDoc[]>();
}
