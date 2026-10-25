import { Types } from "mongoose";
import { z } from "zod";
import { AuditLog, User, type AuditLogDoc, type UserDoc } from "@/models";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { canAssignRole, can, ROLE_DEFAULT_PERMISSIONS, STAFF_AREA_PERMISSIONS, type Actor, type Role } from "@/lib/permissions";
import { hashPassword } from "@/lib/auth/password";
import { escapeRegex } from "@/lib/utils";
import { emailSchema, paginate, parseObjectId, passwordSchema } from "@/lib/validation";

function requireUsersManage(actor: Actor) {
  if (!can(actor, "users.manage")) throw Errors.forbidden();
}

export async function listInternalUsersAdmin(actor: Actor, opts: { q?: string; page?: number } = {}) {
  requireUsersManage(actor);
  const page = opts.page ?? 1;
  const filter: Record<string, unknown> = { role: { $in: actor.role === "OWNER" ? ["OWNER", "ADMIN", "STAFF"] : ["STAFF"] } };
  if (opts.q) filter.$or = [{ name: new RegExp(escapeRegex(opts.q), "i") }, { email: new RegExp(escapeRegex(opts.q), "i") }];
  const [items, total] = await Promise.all([
    User.find(filter).select("name email role status permissions lastLoginAt createdAt isDemo").sort({ role: 1, name: 1 }).skip((page - 1) * 50).limit(50).lean<UserDoc[]>(),
    User.countDocuments(filter),
  ]);
  return paginate(items, total, page, 50);
}

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  role: z.enum(["ADMIN", "STAFF"]),
  password: passwordSchema,
  permissions: z.array(z.enum(STAFF_AREA_PERMISSIONS)).optional(),
});

export async function createInternalUser(actor: Actor, input: unknown) {
  requireUsersManage(actor);
  const data = createUserSchema.parse(input);
  if (!canAssignRole(actor, data.role)) throw Errors.forbidden("Only the owner can create admins.");
  if (await User.exists({ email: data.email })) throw Errors.conflict("A user with this email already exists.");
  const permissions = data.permissions ?? ROLE_DEFAULT_PERMISSIONS[data.role];
  const user = await User.create({ name: data.name, email: data.email, role: data.role, permissions, status: "ACTIVE", passwordHash: await hashPassword(data.password) });
  await audit(actor, "user.created", { entityType: "User", entityId: String(user._id), metadata: { role: data.role } });
  return { id: String(user._id) };
}

export const updateUserSchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "STAFF"]).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  permissions: z.array(z.enum(STAFF_AREA_PERMISSIONS)).optional(),
  name: z.string().trim().min(2).max(120).optional(),
});

export async function updateInternalUser(actor: Actor, userId: string, input: unknown) {
  requireUsersManage(actor);
  const data = updateUserSchema.parse(input);
  const target = await User.findById(parseObjectId(userId)).lean<UserDoc>();
  if (!target || target.role === "CLIENT") throw Errors.notFound();
  const targetRole = target.role as Role;

  // Only the owner may modify owners/admins, promote to admin/owner, or change permissions of admins.
  if ((targetRole === "OWNER" || targetRole === "ADMIN") && actor.role !== "OWNER") throw Errors.forbidden("Only the owner can change admins.");
  if (data.role && !canAssignRole(actor, data.role)) throw Errors.forbidden("Only the owner can assign this role.");
  if (target._id.toString() === actor.id && (data.role || data.status === "SUSPENDED")) throw Errors.badRequest("You can't change your own role or suspend yourself.");
  if (targetRole === "OWNER" && (data.role && data.role !== "OWNER" || data.status === "SUSPENDED")) {
    const owners = await User.countDocuments({ role: "OWNER", status: "ACTIVE" });
    if (owners <= 1) throw Errors.badRequest("There must always be at least one active owner.");
  }

  const set: Record<string, unknown> = { ...data };
  if (data.role && data.role !== targetRole && !data.permissions) set.permissions = ROLE_DEFAULT_PERMISSIONS[data.role];
  const revokeSessions = data.status === "SUSPENDED" || (data.role && data.role !== targetRole) || !!data.permissions;
  await User.updateOne({ _id: target._id }, { $set: set, ...(revokeSessions && { $inc: { sessionVersion: 1 } }) });

  if (data.role && data.role !== targetRole) await audit(actor, "user.role_changed", { entityType: "User", entityId: userId, metadata: { from: targetRole, to: data.role } });
  if (data.status) await audit(actor, data.status === "SUSPENDED" ? "user.suspended" : "user.reactivated", { entityType: "User", entityId: userId });
  if (data.permissions) await audit(actor, "user.permissions_changed", { entityType: "User", entityId: userId, metadata: { permissions: data.permissions } });
}

/** Sign out a user everywhere (also used by "Sign out of all sessions"). */
export async function revokeSessions(actor: Actor, userId: string) {
  if (userId !== actor.id) {
    requireUsersManage(actor);
    const target = await User.findById(parseObjectId(userId)).select("role").lean<{ role: string }>();
    if (!target || (actor.role !== "OWNER" && target.role !== "STAFF")) throw Errors.forbidden();
  }
  await User.updateOne({ _id: parseObjectId(userId) }, { $inc: { sessionVersion: 1 } });
  await audit(actor, "user.sessions_revoked", { entityType: "User", entityId: userId });
}

export async function listAuditLogs(actor: Actor, opts: { action?: string; q?: string; page?: number }) {
  if (!can(actor, "audit.view")) throw Errors.forbidden();
  const page = opts.page ?? 1;
  const filter: Record<string, unknown> = {};
  if (opts.action) filter.action = new RegExp(`^${escapeRegex(opts.action)}`);
  if (opts.q) filter.$or = [{ actorEmail: new RegExp(escapeRegex(opts.q), "i") }, { entityId: opts.q }];
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 50).limit(50).lean<AuditLogDoc[]>(),
    AuditLog.countDocuments(filter),
  ]);
  return paginate(items, total, page, 50);
}

export async function updateOwnProfile(actor: Actor, input: unknown) {
  const data = z
    .object({
      name: z.string().trim().min(2).max(120).optional(),
      phone: z.string().trim().max(40).optional(),
      preferredLanguage: z.string().max(5).optional(),
      notificationPrefs: z.object({ emailOnChatMessage: z.boolean(), emailOnTicketUpdate: z.boolean() }).partial().optional(),
    })
    .parse(input);
  const set: Record<string, unknown> = {};
  if (data.name) set.name = data.name;
  if (data.phone !== undefined) set.phone = data.phone;
  if (data.preferredLanguage) set.preferredLanguage = data.preferredLanguage;
  if (data.notificationPrefs) for (const [k, v] of Object.entries(data.notificationPrefs)) set[`notificationPrefs.${k}`] = v;
  await User.updateOne({ _id: new Types.ObjectId(actor.id) }, { $set: set });
}
