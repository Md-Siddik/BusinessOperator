import { Types } from "mongoose";
import { Notification, User, type NotificationDoc } from "@/models";
import { QUIET_NOTIFICATION_TYPES, type NotificationType } from "@/lib/constants";
import { channels, getRealtime } from "@/lib/realtime";
import { effectivePermissions, type Actor, type Permission, type Role } from "@/lib/permissions";
import { paginate } from "@/lib/validation";
import { Errors } from "@/lib/errors";

export type NotifyInput = {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  /** If set, an existing UNREAD notification with the same key is refreshed instead of duplicated. */
  groupKey?: string;
};

/** Excludes routine sync events stored before they stopped being raised. */
const VISIBLE = { type: { $nin: QUIET_NOTIFICATION_TYPES } };

export async function unreadNotificationCount(userId: string) {
  return Notification.countDocuments({ userId, readAt: null, ...VISIBLE });
}

async function pushCount(userId: string, notification?: unknown) {
  const unreadCount = await unreadNotificationCount(userId);
  getRealtime().publish(channels.user(userId), { type: "notification", unreadCount, notification });
}

export async function notifyUsers(userIds: string[], input: NotifyInput) {
  if (QUIET_NOTIFICATION_TYPES.includes(input.type)) return;
  const unique = [...new Set(userIds.filter(Boolean))];
  await Promise.all(
    unique.map(async (userId) => {
      let doc;
      if (input.groupKey) {
        doc = await Notification.findOneAndUpdate(
          { userId, groupKey: input.groupKey, readAt: null },
          { $set: { type: input.type, title: input.title, body: input.body, link: input.link, updatedAt: new Date() } },
          { new: true, upsert: true, setDefaultsOnInsert: true },
        ).lean();
      } else {
        doc = (await Notification.create({ userId, ...input })).toObject();
      }
      await pushCount(userId, doc);
    }),
  );
}

/** Active internal users holding a permission (OWNER always included). */
export async function internalUserIdsWith(permission: Permission) {
  const users = await User.find({ role: { $in: ["OWNER", "ADMIN", "MANAGER", "STAFF"] }, status: "ACTIVE" })
    .select("_id role permissions permissionGrants")
    .lean<{ _id: Types.ObjectId; role: Role; permissions: string[]; permissionGrants?: { permission: string }[] }[]>();
  return users.filter((u) => effectivePermissions(u.role, u.permissions, u.permissionGrants).includes(permission)).map((u) => String(u._id));
}

export async function notifyInternal(permission: Permission, input: NotifyInput, extraUserIds: string[] = []) {
  const ids = await internalUserIdsWith(permission);
  await notifyUsers([...ids, ...extraUserIds], input);
}

export async function listNotifications(actor: Actor, opts: { page?: number; pageSize?: number; unreadOnly?: boolean } = {}) {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const filter: Record<string, unknown> = { userId: actor.id, ...VISIBLE };
  if (opts.unreadOnly) filter.readAt = null;
  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean<NotificationDoc[]>(),
    Notification.countDocuments(filter),
    unreadNotificationCount(actor.id),
  ]);
  return { ...paginate(items, total, page, pageSize), unread };
}

export async function markNotificationsRead(actor: Actor, ids?: string[]) {
  const filter: Record<string, unknown> = { userId: actor.id, readAt: null };
  if (ids?.length) {
    if (!ids.every((id) => Types.ObjectId.isValid(id))) throw Errors.badRequest("Invalid id");
    filter._id = { $in: ids };
  }
  await Notification.updateMany(filter, { $set: { readAt: new Date() } });
  await pushCount(actor.id);
}

/** Mark grouped notifications read (e.g. when the user opens the conversation). */
export async function markGroupRead(userId: string, groupKey: string) {
  const res = await Notification.updateMany({ userId, groupKey, readAt: null }, { $set: { readAt: new Date() } });
  if (res.modifiedCount) await pushCount(userId);
}
