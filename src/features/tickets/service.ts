import { Types, type FilterQuery } from "mongoose";
import { z } from "zod";
import { PRIORITIES, REQUEST_TYPES, TICKET_STATUSES, type TicketKind } from "@/lib/constants";
import { nextSequence, Organization, SupportTicket, User, type SupportTicketDoc, type UserDoc } from "@/models";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { can, isClient, isInternal, type Actor } from "@/lib/permissions";
import { escapeRegex } from "@/lib/utils";
import { objectId, paginate, parseObjectId } from "@/lib/validation";
import { getStorage, type ValidatedUpload } from "@/lib/storage";
import { sendTransactionalEmail, transactionalTemplates } from "@/lib/email/transactional";
import { notifyInternal, notifyUsers } from "@/features/notifications/service";

/**
 * Access scope (always applied in the database query):
 *  - CLIENT: own organization only
 *  - tickets.manage: everything
 *  - internal staff with tickets.assigned: tickets assigned to them
 *  - other internal staff: none (default deny)
 */
export function ticketAccessFilter(actor: Actor): FilterQuery<SupportTicketDoc> {
  if (isClient(actor)) {
    if (!actor.organizationId) throw Errors.forbidden();
    return { organizationId: new Types.ObjectId(actor.organizationId) };
  }
  if (can(actor, "tickets.manage")) return {};
  if (isInternal(actor)) return can(actor, "tickets.assigned") ? { assignedTo: new Types.ObjectId(actor.id) } : { _id: { $in: [] } };
  throw Errors.forbidden();
}

export const ticketQuerySchema = z.object({
  kind: z.enum(["REQUEST", "TICKET"]).optional(),
  status: z.enum(TICKET_STATUSES).optional(),
  open: z.coerce.boolean().optional(),
  priority: z.enum(PRIORITIES).optional(),
  organizationId: objectId.optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export async function listTickets(actor: Actor, input: unknown) {
  const q = ticketQuerySchema.parse(input);
  const filter: FilterQuery<SupportTicketDoc> = { ...ticketAccessFilter(actor) };
  if (q.kind) filter.kind = q.kind;
  if (q.status) filter.status = q.status;
  else if (q.open) filter.status = { $in: ["OPEN", "IN_PROGRESS", "WAITING_FOR_CLIENT"] };
  if (q.priority) filter.priority = q.priority;
  if (q.organizationId && isInternal(actor)) filter.organizationId = new Types.ObjectId(q.organizationId);
  if (q.q) filter.title = new RegExp(escapeRegex(q.q), "i");
  const [items, total] = await Promise.all([
    SupportTicket.find(filter)
      .select("-comments -description")
      .sort({ updatedAt: -1 })
      .skip((q.page - 1) * 25)
      .limit(25)
      .populate("organizationId", "name")
      .populate("assignedTo", "name")
      .lean(),
    SupportTicket.countDocuments(filter),
  ]);
  return paginate(items, total, q.page, 25);
}

export const createTicketSchema = z.object({
  kind: z.enum(["REQUEST", "TICKET"]),
  title: z.string().trim().min(3, "Add a short title").max(200),
  description: z.string().trim().min(5, "Describe what you need").max(10_000),
  requestType: z.enum(REQUEST_TYPES).optional(),
  priority: z.enum(PRIORITIES).default("NORMAL"),
  organizationId: objectId.optional(),
  dueDate: z.coerce.date().optional(),
});

export async function createTicket(actor: Actor, input: unknown, files: ValidatedUpload[] = []) {
  const data = createTicketSchema.parse(input);
  let organizationId: string;
  if (isClient(actor)) {
    organizationId = actor.organizationId!;
  } else {
    if (!can(actor, "tickets.manage")) throw Errors.forbidden();
    if (!data.organizationId) throw Errors.badRequest("Choose a client");
    organizationId = data.organizationId;
  }
  const org = await Organization.findById(organizationId).select("name").lean<{ name: string }>();
  if (!org) throw Errors.notFound();
  const attachments = [];
  for (const f of files) attachments.push({ fileKey: await getStorage().save(f.data, f.name), name: f.name, mimeType: f.mimeType, size: f.size });
  const ticket = await SupportTicket.create({
    ...data,
    organizationId,
    number: await nextSequence("ticket"),
    createdBy: actor.id,
    attachments,
  });
  await audit(actor, "ticket.created", { entityType: "SupportTicket", entityId: String(ticket._id), organizationId, metadata: { kind: data.kind, number: ticket.number } });
  if (isClient(actor)) {
    await notifyInternal("tickets.manage", {
      type: "CLIENT_REQUEST",
      title: `${org.name}: new ${data.kind === "REQUEST" ? "request" : "ticket"} #${ticket.number}`,
      body: data.title,
      link: `/dashboard/tickets/${ticket._id}`,
    });
  }
  return ticket.toObject();
}

async function loadTicket(actor: Actor, id: string) {
  const ticket = await SupportTicket.findOne({ _id: parseObjectId(id), ...ticketAccessFilter(actor) }).lean<SupportTicketDoc>();
  if (!ticket) throw Errors.notFound();
  return ticket;
}

export async function getTicket(actor: Actor, id: string) {
  const ticket = await SupportTicket.findOne({ _id: parseObjectId(id), ...ticketAccessFilter(actor) })
    .populate("organizationId", "name")
    .populate("assignedTo", "name")
    .populate("createdBy", "name role")
    .populate("comments.authorId", "name role")
    .lean<SupportTicketDoc>();
  if (!ticket) throw Errors.notFound();
  // Internal comments are never sent to clients.
  if (isClient(actor)) ticket.comments = ticket.comments.filter((c) => !c.internal) as typeof ticket.comments;
  return ticket;
}

export const updateTicketSchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignedTo: objectId.nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
});

export async function updateTicket(actor: Actor, id: string, input: unknown) {
  const data = updateTicketSchema.parse(input);
  const ticket = await loadTicket(actor, id);
  if (isClient(actor)) {
    // Clients may only close or re-open their own tickets.
    if (Object.keys(data).some((k) => k !== "status") || (data.status && !["CLOSED", "OPEN"].includes(data.status))) throw Errors.forbidden();
  } else if (data.assignedTo !== undefined && !can(actor, "tickets.manage")) {
    throw Errors.forbidden("Only managers can reassign.");
  }
  if (data.assignedTo) {
    const ok = await User.exists({ _id: data.assignedTo, role: { $in: ["OWNER", "ADMIN", "STAFF"] }, status: "ACTIVE" });
    if (!ok) throw Errors.badRequest("Assignee must be an active internal user.");
  }
  const set: Record<string, unknown> = { ...data };
  if (data.status === "RESOLVED" || data.status === "CLOSED") set.resolvedAt = new Date();
  await SupportTicket.updateOne({ _id: ticket._id }, { $set: set });

  if (data.status && data.status !== ticket.status) {
    await audit(actor, "ticket.status_changed", { entityType: "SupportTicket", entityId: id, organizationId: String(ticket.organizationId), metadata: { from: ticket.status, to: data.status } });
    if (isInternal(actor)) await notifyClientUsers(ticket, `#${ticket.number} is now ${data.status.replace(/_/g, " ").toLowerCase()}`, data.status);
  }
  if (data.assignedTo && String(data.assignedTo) !== String(ticket.assignedTo ?? "")) {
    await notifyUsers([data.assignedTo], { type: "CLIENT_REQUEST", title: `Assigned to you: #${ticket.number} ${ticket.title}`, link: `/dashboard/tickets/${id}` });
  }
}

async function notifyClientUsers(ticket: SupportTicketDoc, title: string, status?: string) {
  const users = await User.find({ organizationId: ticket.organizationId, status: "ACTIVE" }).lean<UserDoc[]>();
  const base = ticket.kind === "REQUEST" ? "/portal/requests" : "/portal/tickets";
  await notifyUsers(users.map((u) => String(u._id)), { type: "CLIENT_REQUEST", title, body: ticket.title, link: `${base}/${ticket._id}` });
  if (status) {
    for (const u of users.filter((u) => u.notificationPrefs?.emailOnTicketUpdate !== false)) {
      await sendTransactionalEmail({ to: u.email, toName: u.name, ...transactionalTemplates.ticketUpdated(u.name, ticket.number, ticket.title, status, ticket.kind) });
    }
  }
}

export const commentSchema = z.object({ body: z.string().trim().min(1).max(5000), internal: z.boolean().default(false) });

export async function addTicketComment(actor: Actor, id: string, input: unknown) {
  const data = commentSchema.parse(input);
  const ticket = await loadTicket(actor, id);
  const internal = isInternal(actor) ? data.internal : false;
  const update: Record<string, unknown> = { $push: { comments: { authorId: actor.id, body: data.body, internal, createdAt: new Date() } } };
  // A client reply moves "waiting for client" back to the team.
  if (isClient(actor) && ticket.status === "WAITING_FOR_CLIENT") update.$set = { status: "IN_PROGRESS" };
  await SupportTicket.updateOne({ _id: ticket._id }, update);
  if (isClient(actor)) {
    const recipients = ticket.assignedTo ? [String(ticket.assignedTo)] : [];
    if (recipients.length) await notifyUsers(recipients, { type: "CLIENT_REQUEST", title: `New comment on #${ticket.number}`, body: data.body.slice(0, 140), link: `/dashboard/tickets/${id}` });
    else await notifyInternal("tickets.manage", { type: "CLIENT_REQUEST", title: `New comment on #${ticket.number}`, body: data.body.slice(0, 140), link: `/dashboard/tickets/${id}` });
  } else if (!internal) {
    await notifyClientUsers(ticket, `New reply on #${ticket.number}`);
  }
}

export async function addTicketAttachments(actor: Actor, id: string, files: ValidatedUpload[]) {
  const ticket = await loadTicket(actor, id);
  const attachments = [];
  for (const f of files) attachments.push({ fileKey: await getStorage().save(f.data, f.name), name: f.name, mimeType: f.mimeType, size: f.size });
  await SupportTicket.updateOne({ _id: ticket._id }, { $push: { attachments: { $each: attachments } } });
}

export async function getTicketAttachment(actor: Actor, id: string, attachmentId: string) {
  const ticket = await loadTicket(actor, id);
  const att = ticket.attachments.find((a) => String(a._id) === attachmentId);
  if (!att) throw Errors.notFound();
  return { attachment: att, data: await getStorage().read(att.fileKey) };
}

export async function ticketCounts(actor: Actor, kind?: TicketKind) {
  const filter: FilterQuery<SupportTicketDoc> = { ...ticketAccessFilter(actor), status: { $in: ["OPEN", "IN_PROGRESS", "WAITING_FOR_CLIENT"] } };
  if (kind) filter.kind = kind;
  return SupportTicket.countDocuments(filter);
}
