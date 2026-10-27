import { Types, type FilterQuery } from "mongoose";
import { z } from "zod";
import { CONVERSATION_STATUSES, CONVERSATION_TOPICS, PRIORITIES, UPLOAD_LIMITS } from "@/lib/constants";
import { Conversation, Message, Organization, User, type ConversationDoc, type MessageDoc, type UserDoc } from "@/models";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { can, isClient, isInternal, type Actor } from "@/lib/permissions";
import { escapeRegex, truncate } from "@/lib/utils";
import { objectId, parseObjectId } from "@/lib/validation";
import { channels, getRealtime } from "@/lib/realtime";
import { getStorage, type ValidatedUpload } from "@/lib/storage";
import { sendTransactionalEmail, transactionalTemplates } from "@/lib/email/transactional";
import { getSetting } from "@/features/settings/service";
import type { ChatSettings } from "@/features/settings/schemas";
import { internalUserIdsWith, markGroupRead, notifyUsers } from "@/features/notifications/service";

/**
 * Conversation access, enforced in every query:
 *  - CLIENT: conversations of their own organization only
 *  - OWNER, or internal users with chat.manage: all conversations
 *  - STAFF/ADMIN with conversations.assigned: conversations assigned to them or where they participate
 *  - other STAFF/ADMIN: none (default deny)
 */
export function conversationAccessFilter(actor: Actor): FilterQuery<ConversationDoc> {
  if (isClient(actor)) {
    if (!actor.organizationId) throw Errors.forbidden();
    return { organizationId: new Types.ObjectId(actor.organizationId) };
  }
  if (!isInternal(actor)) throw Errors.forbidden();
  if (can(actor, "chat.manage")) return {};
  if (!can(actor, "conversations.assigned")) return { _id: { $in: [] } };
  const me = new Types.ObjectId(actor.id);
  return { $or: [{ assignedTo: me }, { "participants.userId": me }] };
}

/** Same rule evaluated in memory, for filtering realtime events per subscriber. */
export function canSeeConversationEvent(actor: Actor, e: { organizationId: string; assignedTo?: string | null; participantIds: string[] }) {
  if (isClient(actor)) return actor.organizationId === e.organizationId;
  if (!isInternal(actor)) return false;
  if (can(actor, "chat.manage")) return true;
  if (!can(actor, "conversations.assigned")) return false;
  return e.assignedTo === actor.id || e.participantIds.includes(actor.id);
}

async function loadConversation(actor: Actor, id: string) {
  const conv = await Conversation.findOne({ _id: parseObjectId(id), ...conversationAccessFilter(actor) }).lean<ConversationDoc>();
  if (!conv) throw Errors.notFound();
  return conv;
}

function eventMeta(conv: Pick<ConversationDoc, "_id" | "organizationId" | "assignedTo" | "participants">) {
  return {
    conversationId: String(conv._id),
    organizationId: String(conv.organizationId),
    assignedTo: conv.assignedTo ? String(conv.assignedTo) : null,
    participantIds: conv.participants.map((p) => String(p.userId)),
  };
}

function publishToAll(conv: Pick<ConversationDoc, "_id" | "organizationId" | "assignedTo" | "participants">, build: (meta: ReturnType<typeof eventMeta>) => Parameters<ReturnType<typeof getRealtime>["publish"]>[1]) {
  const event = build(eventMeta(conv));
  const rt = getRealtime();
  rt.publish(channels.organization(String(conv.organizationId)), event);
  rt.publish(channels.internal, event);
}

/** Shape a message for the wire. Attachment file keys never leave the server. */
function serializeMessage(m: MessageDoc & { senderId?: unknown }) {
  const sender = m.senderId as { _id?: Types.ObjectId; name?: string } | Types.ObjectId | undefined | null;
  const senderObj = sender && typeof sender === "object" && "name" in sender ? sender : null;
  return {
    _id: String(m._id),
    conversationId: String(m.conversationId),
    senderId: senderObj?._id ? String(senderObj._id) : sender ? String(sender) : null,
    senderName: senderObj?.name ?? (m.system ? "ExploreTechify" : undefined),
    senderRole: m.senderRole,
    body: m.body,
    system: m.system,
    attachments: m.attachments.map((a) => ({ _id: String(a._id), name: a.name, mimeType: a.mimeType, size: a.size })),
    readBy: m.readBy.map(String),
    createdAt: m.createdAt,
  };
}
export type SerializedMessage = ReturnType<typeof serializeMessage>;

/* ───────────── Listing & search ───────────── */

export const conversationQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(CONVERSATION_STATUSES).optional(),
  assigned: z.enum(["me", "unassigned", "all"]).optional(),
  organizationId: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function listConversations(actor: Actor, input: unknown) {
  const q = conversationQuerySchema.parse(input ?? {});
  const and: FilterQuery<ConversationDoc>[] = [conversationAccessFilter(actor)];
  if (q.status) and.push({ status: q.status });
  if (q.assigned === "me") and.push({ assignedTo: new Types.ObjectId(actor.id) });
  if (q.assigned === "unassigned") and.push({ assignedTo: null });
  if (q.organizationId && isInternal(actor)) and.push({ organizationId: new Types.ObjectId(q.organizationId) });
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    const or: FilterQuery<ConversationDoc>[] = [{ subject: rx }, { lastMessagePreview: rx }];
    const topic = CONVERSATION_TOPICS.find((t) => t.replace(/_/g, " ").toLowerCase().includes(q.q!.toLowerCase()));
    if (topic) or.push({ topic });
    if (isInternal(actor)) {
      const orgIds = await Organization.find({ name: rx }).limit(50).distinct("_id");
      if (orgIds.length) or.push({ organizationId: { $in: orgIds } });
    }
    // Full-text search over message bodies, restricted to the actor's organization for clients.
    const msgFilter: FilterQuery<MessageDoc> = { $text: { $search: q.q } };
    if (isClient(actor)) msgFilter.organizationId = new Types.ObjectId(actor.organizationId!);
    const convIds = await Message.find(msgFilter).limit(200).distinct("conversationId");
    if (convIds.length) or.push({ _id: { $in: convIds } });
    and.push({ $or: or });
  }

  const conversations = await Conversation.find({ $and: and })
    .sort({ lastMessageAt: -1 })
    .limit(q.limit)
    .populate("organizationId", "name")
    .populate("assignedTo", "name")
    .lean();

  const me = new Types.ObjectId(actor.id);
  const unread = await Message.aggregate([
    { $match: { conversationId: { $in: conversations.map((c) => c._id) }, senderId: { $ne: me }, readBy: { $ne: me } } },
    { $group: { _id: "$conversationId", n: { $sum: 1 } } },
  ]);
  const unreadMap = new Map(unread.map((u) => [String(u._id), u.n as number]));
  return conversations.map((c) => ({ ...c, unreadCount: unreadMap.get(String(c._id)) ?? 0 }));
}

/** Badge count: conversations with unread messages for this actor. */
export async function unreadConversationCount(actor: Actor) {
  // Team members without conversation access (e.g. Digital Marketers) simply have nothing unread.
  if (!isClient(actor) && !(isInternal(actor) && (can(actor, "chat.manage") || can(actor, "conversations.assigned")))) return 0;
  const me = new Types.ObjectId(actor.id);
  const access = conversationAccessFilter(actor);
  const msgMatch: FilterQuery<MessageDoc> = { senderId: { $ne: me }, readBy: { $ne: me } };
  if (isClient(actor)) msgMatch.organizationId = new Types.ObjectId(actor.organizationId!);
  else if (Object.keys(access).length) msgMatch.conversationId = { $in: await Conversation.find(access).distinct("_id") };
  const res = await Message.aggregate([{ $match: msgMatch }, { $group: { _id: "$conversationId" } }, { $count: "n" }]);
  return (res[0]?.n as number) ?? 0;
}

export async function getConversation(actor: Actor, id: string, opts: { before?: string; limit?: number } = {}) {
  const conv = await loadConversation(actor, id);
  const limit = Math.min(opts.limit ?? 100, 200);
  const msgFilter: FilterQuery<MessageDoc> = { conversationId: conv._id };
  if (opts.before && Types.ObjectId.isValid(opts.before)) msgFilter._id = { $lt: new Types.ObjectId(opts.before) };
  const [messages, populated] = await Promise.all([
    Message.find(msgFilter).sort({ createdAt: -1 }).limit(limit).populate("senderId", "name").lean<MessageDoc[]>(),
    Conversation.findById(conv._id).populate("organizationId", "name").populate("assignedTo", "name").populate("participants.userId", "name role").lean(),
  ]);
  await markConversationRead(actor, id);
  return { conversation: populated!, messages: messages.reverse().map(serializeMessage), hasMore: messages.length === limit };
}

/* ───────────── Writing ───────────── */

export const startConversationSchema = z.object({
  subject: z.string().trim().min(2, "Add a subject").max(200),
  topic: z.enum(CONVERSATION_TOPICS).default("GENERAL"),
  body: z.string().trim().min(1, "Write a message").max(10_000),
  organizationId: objectId.optional(),
  priority: z.enum(PRIORITIES).default("NORMAL"),
});

export async function startConversation(actor: Actor, input: unknown, files: ValidatedUpload[] = []) {
  const data = startConversationSchema.parse(input);
  const settings = await getSetting("chat");
  let organizationId: string;
  if (isClient(actor)) organizationId = actor.organizationId!;
  else {
    if (!can(actor, "chat.manage") && !can(actor, "clients.manage")) throw Errors.forbidden();
    if (!data.organizationId) throw Errors.badRequest("Choose a client");
    organizationId = data.organizationId;
  }
  const org = await Organization.findById(organizationId).select("status").lean<{ status: string }>();
  if (!org) throw Errors.notFound();
  if (org.status === "SUSPENDED") throw Errors.badRequest("This client account is suspended, so a conversation can't be started.");

  const defaultAssignee = isClient(actor) ? await resolveDefaultAssignee(settings) : actor.id;
  const conv = await Conversation.create({
    organizationId,
    subject: data.subject,
    topic: data.topic,
    priority: isClient(actor) ? "NORMAL" : data.priority,
    status: "OPEN",
    createdBy: actor.id,
    assignedTo: defaultAssignee ?? undefined,
    participants: [{ userId: actor.id, role: actor.role }],
    lastMessageAt: new Date(),
  });
  await audit(actor, "chat.conversation_started", { entityType: "Conversation", entityId: String(conv._id), organizationId, metadata: { topic: data.topic } });
  const message = await postMessage(actor, conv.toObject(), data.body, files);

  if (isClient(actor) && settings.autoResponse.enabled && (!settings.autoResponse.outsideHoursOnly || !isWithinWorkingHours(settings))) {
    await createSystemMessage(conv.toObject(), settings.autoResponse.message);
  }
  return { conversationId: String(conv._id), message };
}

async function resolveDefaultAssignee(settings: ChatSettings) {
  if (!settings.defaultAssigneeId || !Types.ObjectId.isValid(settings.defaultAssigneeId)) return null;
  const ok = await User.exists({ _id: settings.defaultAssigneeId, role: { $in: ["OWNER", "ADMIN", "MANAGER", "STAFF"] }, status: "ACTIVE" });
  return ok ? settings.defaultAssigneeId : null;
}

export const sendMessageSchema = z.object({ body: z.string().trim().max(10_000).default("") });

export async function sendMessage(actor: Actor, conversationId: string, input: unknown, files: ValidatedUpload[] = []) {
  const { body } = sendMessageSchema.parse(input);
  if (!body && !files.length) throw Errors.badRequest("Write a message or attach a file.");
  if (files.length > UPLOAD_LIMITS.maxFilesPerMessage) throw Errors.badRequest(`Attach at most ${UPLOAD_LIMITS.maxFilesPerMessage} files.`);
  const conv = await loadConversation(actor, conversationId);
  if (conv.status === "CLOSED" && isClient(actor)) {
    // Replying to a closed conversation re-opens it for the team.
    await Conversation.updateOne({ _id: conv._id }, { $set: { status: "OPEN" } });
  }
  return postMessage(actor, conv, body, files);
}

async function postMessage(actor: Actor, conv: ConversationDoc, body: string, files: ValidatedUpload[]) {
  const attachments = [];
  for (const f of files) attachments.push({ fileKey: await getStorage().save(f.data, f.name), name: f.name, mimeType: f.mimeType, size: f.size });
  // Replying implies the sender has read the conversation so far.
  const me = new Types.ObjectId(actor.id);
  const read = await Message.updateMany({ conversationId: conv._id, readBy: { $ne: me } }, { $addToSet: { readBy: me } });
  if (read.modifiedCount) publishToAll(conv, (meta) => ({ type: "message.read", conversationId: meta.conversationId, organizationId: meta.organizationId, userId: actor.id }));
  const msg = await Message.create({
    conversationId: conv._id,
    organizationId: conv.organizationId,
    senderId: actor.id,
    senderRole: actor.role,
    body,
    attachments,
    readBy: [actor.id],
  });

  const fromClient = isClient(actor);
  const set: Record<string, unknown> = {
    lastMessageAt: msg.createdAt,
    lastMessagePreview: truncate(body || `📎 ${attachments.map((a) => a.name).join(", ")}`, 140),
    lastMessageSenderId: actor.id,
    lastMessageFromClient: fromClient,
  };
  if (fromClient && ["WAITING_FOR_CLIENT", "RESOLVED", "CLOSED"].includes(conv.status)) set.status = conv.status === "WAITING_FOR_CLIENT" ? "IN_PROGRESS" : "OPEN";
  const isParticipant = conv.participants.some((p) => String(p.userId) === actor.id);
  const updated = await Conversation.findByIdAndUpdate(
    conv._id,
    { $set: set, ...(!isParticipant && { $push: { participants: { userId: actor.id, role: actor.role, joinedAt: new Date() } } }) },
    { new: true },
  ).lean<ConversationDoc>();

  const populated = await Message.findById(msg._id).populate("senderId", "name").lean<MessageDoc>();
  const serialized = serializeMessage(populated!);
  publishToAll(updated!, (meta) => ({ type: "message.created", ...meta, message: serialized }));
  await notifyAboutMessage(actor, updated!, body);
  return serialized;
}

async function createSystemMessage(conv: ConversationDoc, body: string) {
  const msg = await Message.create({ conversationId: conv._id, organizationId: conv.organizationId, senderRole: "SYSTEM", body, system: true, readBy: [] });
  await Conversation.updateOne({ _id: conv._id }, { $set: { lastMessageAt: msg.createdAt } });
  publishToAll(conv, (meta) => ({ type: "message.created", ...meta, message: serializeMessage(msg.toObject()) }));
}

const g = globalThis as unknown as { __etChatEmailThrottle?: Map<string, number> };
const emailThrottle = (g.__etChatEmailThrottle ??= new Map());
const EMAIL_THROTTLE_MS = 30 * 60_000;

/** One email per user per conversation per 30 minutes — no email flood for every short message. */
function shouldEmail(userId: string, conversationId: string) {
  const key = `${userId}:${conversationId}`;
  const last = emailThrottle.get(key) ?? 0;
  if (Date.now() - last < EMAIL_THROTTLE_MS) return false;
  emailThrottle.set(key, Date.now());
  return true;
}

async function notifyAboutMessage(actor: Actor, conv: ConversationDoc, body: string) {
  const settings = await getSetting("chat");
  const org = await Organization.findById(conv.organizationId).select("name status").lean<{ name: string; status: string }>();
  const groupKey = `conv:${conv._id}`;
  if (isClient(actor)) {
    let recipients: string[];
    if (conv.assignedTo) recipients = [String(conv.assignedTo)];
    else if (settings.recipientUserIds.length) recipients = settings.recipientUserIds;
    else recipients = await internalUserIdsWith("chat.manage");
    await notifyUsers(recipients, { type: "CHAT_MESSAGE", title: `New message from ${org?.name ?? "a client"}`, body: truncate(body, 140), link: `/dashboard/messages?c=${conv._id}`, groupKey });
    if (settings.emailNotifications) {
      const users = await User.find({ _id: { $in: recipients }, status: "ACTIVE" }).lean<UserDoc[]>();
      for (const u of users) {
        if (u.notificationPrefs?.emailOnChatMessage === false || !shouldEmail(String(u._id), String(conv._id))) continue;
        await sendTransactionalEmail({ to: u.email, toName: u.name, ...transactionalTemplates.newClientMessageForStaff(org?.name ?? "a client", conv.subject, String(conv._id)) });
      }
    }
  } else {
    // Everyone in the client organization who can read the reply: active users, and — while the
    // organization awaits approval — the signed-up users who are allowed to chat already.
    const statuses = org?.status === "ACTIVE" ? ["ACTIVE"] : org?.status === "PENDING_APPROVAL" ? ["ACTIVE", "PENDING_APPROVAL"] : [];
    const clients = statuses.length ? await User.find({ organizationId: conv.organizationId, role: "CLIENT", status: { $in: statuses } }).lean<UserDoc[]>() : [];
    await notifyUsers(clients.map((u) => String(u._id)), { type: "CHAT_MESSAGE", title: `New reply from ${actor.name}`, body: truncate(body, 140), link: `/portal/messages?c=${conv._id}`, groupKey });
    if (settings.emailNotifications) {
      for (const u of clients) {
        if (u.notificationPrefs?.emailOnChatMessage === false || !shouldEmail(String(u._id), String(conv._id))) continue;
        await sendTransactionalEmail({ to: u.email, toName: u.name, ...transactionalTemplates.newReplyForClient(u.name, conv.subject, String(conv._id)) });
      }
    }
  }
}

export async function markConversationRead(actor: Actor, conversationId: string) {
  const conv = await loadConversation(actor, conversationId);
  const me = new Types.ObjectId(actor.id);
  const res = await Message.updateMany({ conversationId: conv._id, readBy: { $ne: me } }, { $addToSet: { readBy: me } });
  if (res.modifiedCount) {
    publishToAll(conv, (meta) => ({ type: "message.read", conversationId: meta.conversationId, organizationId: meta.organizationId, userId: actor.id }));
  }
  await markGroupRead(actor.id, `conv:${conv._id}`);
}

export const updateConversationSchema = z.object({
  status: z.enum(CONVERSATION_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignedTo: objectId.nullable().optional(),
});

export async function updateConversation(actor: Actor, conversationId: string, input: unknown) {
  if (!isInternal(actor)) {
    // Clients may only close their own conversation.
    const { status } = z.object({ status: z.literal("CLOSED") }).parse(input);
    const conv = await loadConversation(actor, conversationId);
    await Conversation.updateOne({ _id: conv._id }, { $set: { status } });
    publishToAll(conv, (meta) => ({ type: "conversation.updated", ...meta, conversation: { status } }));
    return;
  }
  const data = updateConversationSchema.parse(input);
  const conv = await loadConversation(actor, conversationId);
  if (data.assignedTo !== undefined && !can(actor, "chat.manage")) throw Errors.forbidden("Only chat managers can reassign conversations.");
  if (data.assignedTo) {
    const ok = await User.exists({ _id: data.assignedTo, role: { $in: ["OWNER", "ADMIN", "MANAGER", "STAFF"] }, status: "ACTIVE" });
    if (!ok) throw Errors.badRequest("Assignee must be an active internal user.");
  }
  const updated = await Conversation.findByIdAndUpdate(conv._id, { $set: data }, { new: true }).populate("assignedTo", "name").lean<ConversationDoc>();
  await audit(actor, data.assignedTo !== undefined ? "chat.assigned" : "chat.updated", { entityType: "Conversation", entityId: conversationId, organizationId: String(conv.organizationId), metadata: data });
  if (data.assignedTo && data.assignedTo !== actor.id) {
    await notifyUsers([data.assignedTo], { type: "CHAT_MESSAGE", title: `Conversation assigned to you: ${conv.subject}`, link: `/dashboard/messages?c=${conversationId}` });
  }
  publishToAll(updated!, (meta) => ({ type: "conversation.updated", ...meta, conversation: { status: updated!.status, priority: updated!.priority, assignedTo: updated!.assignedTo } }));
}

/** Attachment download — authorized via the conversation (never by attachment id alone). */
export async function getMessageAttachment(actor: Actor, conversationId: string, attachmentId: string) {
  const conv = await loadConversation(actor, conversationId);
  const msg = await Message.findOne({ conversationId: conv._id, "attachments._id": parseObjectId(attachmentId) }).lean<MessageDoc>();
  const att = msg?.attachments.find((a) => String(a._id) === attachmentId);
  if (!att) throw Errors.notFound();
  return { attachment: att, data: await getStorage().read(att.fileKey) };
}

/* ───────────── Availability ───────────── */

export function isWithinWorkingHours(settings: ChatSettings, now = new Date()) {
  const { timezone, days, start, end } = settings.workingHours;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
    const hm = `${parts.find((p) => p.type === "hour")?.value}:${parts.find((p) => p.type === "minute")?.value}`;
    return days.includes(day) && hm >= start && hm < end;
  } catch {
    return false;
  }
}

/** Honest availability: working hours only — never a fake "online" indicator. */
export async function getAvailability() {
  const settings = await getSetting("chat");
  return { text: settings.availabilityText, withinHours: isWithinWorkingHours(settings), hours: settings.workingHours };
}
