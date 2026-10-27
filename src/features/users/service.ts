import { Types } from "mongoose";
import { z } from "zod";
import { AuditLog, Company, ContactRequest, Conversation, FollowUp, Notification, Organization, Project, ProjectTask, SupportTicket, User, type AuditLogDoc, type UserDoc } from "@/models";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { canAssignRole, can, effectivePermissions, PERMISSIONS, ROLE_TEMPLATES, type Actor, type Permission, type Role } from "@/lib/permissions";
import { applyRoleChange, changeAccess, grantDecision, grantInitialAccess, revalidateGrantsIssuedBy } from "@/features/access/service";
import { hashPassword } from "@/lib/auth/password";
import { escapeRegex } from "@/lib/utils";
import { emailSchema, paginate, parseObjectId, passwordSchema } from "@/lib/validation";

function requireUsersManage(actor: Actor) {
  if (!can(actor, "users.manage")) throw Errors.forbidden();
}

export async function listInternalUsersAdmin(actor: Actor, opts: { q?: string; page?: number } = {}) {
  requireUsersManage(actor);
  const page = opts.page ?? 1;
  const filter: Record<string, unknown> = { role: { $in: actor.role === "OWNER" ? ["OWNER", "ADMIN", "STAFF", "DIGITAL_MARKETER"] : ["STAFF"] } };
  if (opts.q) filter.$or = [{ name: new RegExp(escapeRegex(opts.q), "i") }, { email: new RegExp(escapeRegex(opts.q), "i") }];
  const [items, total] = await Promise.all([
    User.find(filter).select("name email role status permissions permissionGrants lastLoginAt createdAt isDemo").sort({ role: 1, name: 1 }).skip((page - 1) * 50).limit(50).lean<UserDoc[]>(),
    User.countDocuments(filter),
  ]);
  return paginate(items, total, page, 50);
}

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  role: z.enum(["ADMIN", "STAFF", "DIGITAL_MARKETER"]),
  /** Required for a new account; ignored when an existing account is linked (its password is never changed). */
  password: passwordSchema.optional(),
  /** Initial access. Every entry is checked like an individual grant (Company Intelligence is always refused). */
  permissions: z.array(z.enum(PERMISSIONS)).optional(),
});

const TEAM_ROLES_LIST = ["OWNER", "ADMIN", "STAFF", "DIGITAL_MARKETER"];

export type EmployeeCandidate =
  | { status: "NEW"; message: string }
  | { status: "LINKABLE"; message: string; name: string; role: Role; hasPassword: boolean }
  | { status: "MEMBER" | "BLOCKED"; message: string; name?: string; role?: Role };

/** Only the Owner and Super Admins (with "Manage Staff Accounts") add employees directly. */
function requireDirectAdd(actor: Actor) {
  requireUsersManage(actor);
  if (actor.role !== "OWNER" && actor.role !== "ADMIN") throw Errors.forbidden();
}

/**
 * What adding `email` as an employee would do. One account = one role in this identity model:
 *  - no account → a new employee account is created;
 *  - a team account that was invited but never activated → it is activated as-is (linked);
 *  - an active team member → duplicate, refused; suspended → reactivate it instead;
 *  - a client account → refused (it can't also be an employee).
 */
export async function lookupEmployeeCandidate(actor: Actor, emailInput: unknown): Promise<EmployeeCandidate> {
  requireDirectAdd(actor);
  const email = emailSchema.parse(emailInput);
  const u = await User.findOne({ email }).select("name role status +passwordHash").lean<UserDoc & { passwordHash?: string }>();
  if (!u) return { status: "NEW", message: "No account yet — a new employee account will be created." };
  const role = u.role as Role;
  if (!TEAM_ROLES_LIST.includes(role)) return { status: "BLOCKED", name: u.name, role, message: "This email belongs to a client account, so it can't also be an employee." };
  if (u.status === "ACTIVE") return { status: "MEMBER", name: u.name, role, message: `${u.name} is already an employee.` };
  if (u.status === "SUSPENDED") return { status: "BLOCKED", name: u.name, role, message: `${u.name} is suspended — reactivate the account instead of adding it again.` };
  if (!canAssignRole(actor, role)) return { status: "BLOCKED", name: u.name, role, message: "Only the Owner can activate this account." };
  return { status: "LINKABLE", name: u.name, role, hasPassword: !!u.passwordHash, message: `${u.name} has an account that was never activated. It will be activated with its existing details and role.` };
}

export async function createInternalUser(actor: Actor, input: unknown) {
  requireDirectAdd(actor);
  const data = createUserSchema.parse(input);
  const candidate = await lookupEmployeeCandidate(actor, data.email);
  if (candidate.status === "MEMBER" || candidate.status === "BLOCKED") throw Errors.conflict(candidate.message);
  if (candidate.status === "LINKABLE") return linkExistingEmployee(actor, data.email, candidate);
  if (!canAssignRole(actor, data.role)) throw Errors.forbidden(data.role === "ADMIN" ? "Only the owner can create admins." : "Only the owner can create this kind of account.");
  if (!data.password) throw Errors.badRequest("Set an initial password for the new account.", { fieldErrors: { password: ["Required for a new account"] } });
  // Without an explicit list, the role's suggested starting access applies — limited to what this actor may grant.
  const requested: Permission[] = data.permissions ?? ROLE_TEMPLATES[data.role].filter((p) => grantDecision(actor, { id: "new", role: data.role }, p).ok);
  for (const p of requested) {
    const d = grantDecision(actor, { id: "new", role: data.role }, p);
    if (!d.ok) throw Errors.forbidden(d.reason);
  }
  let user;
  try {
    // Active immediately: no invitation or approval step. Email ownership is still confirmed at first sign-in.
    user = await User.create({ name: data.name, email: data.email, role: data.role, permissions: [], permissionGrants: [], status: "ACTIVE", passwordHash: await hashPassword(data.password), addedBy: new Types.ObjectId(actor.id), addedAt: new Date() });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw Errors.conflict("A user with this email already exists.");
    throw e;
  }
  await audit(actor, "user.created", { entityType: "User", entityId: String(user._id), metadata: { role: data.role, direct: true } });
  await grantInitialAccess(actor, user._id, data.role, requested);
  return { id: String(user._id), linked: false };
}

/** Activate an invited-but-never-activated team account. Name, password, role and access are kept as they are. */
async function linkExistingEmployee(actor: Actor, email: string, candidate: Extract<EmployeeCandidate, { status: "LINKABLE" }>) {
  const now = new Date();
  const res = await User.findOneAndUpdate(
    { email, status: "PENDING_APPROVAL", role: candidate.role },
    { $set: { status: "ACTIVE", addedBy: new Types.ObjectId(actor.id), addedAt: now }, $unset: { invitationTokenHash: 1, invitationExpiresAt: 1 } },
    { new: true },
  ).lean<UserDoc>();
  if (!res) throw Errors.conflict("This account changed while it was being added — please try again.");
  const { ensureGrantsRecorded } = await import("@/features/access/service");
  await ensureGrantsRecorded(res._id);
  await audit(actor, "user.added_existing", { entityType: "User", entityId: String(res._id), metadata: { role: candidate.role, direct: true } });
  return { id: String(res._id), linked: true, needsPassword: !candidate.hasPassword };
}

export const updateUserSchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "STAFF", "DIGITAL_MARKETER"]).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  /** Full desired permission list (older clients). Applied as individual, policy-checked grants and revocations. */
  permissions: z.array(z.enum(PERMISSIONS)).optional(),
  name: z.string().trim().min(2).max(120).optional(),
});

export async function updateInternalUser(actor: Actor, userId: string, input: unknown) {
  requireUsersManage(actor);
  const data = updateUserSchema.parse(input);
  const target = await User.findById(parseObjectId(userId)).lean<UserDoc>();
  if (!target || target.role === "CLIENT") throw Errors.notFound();
  const targetRole = target.role as Role;

  // Only the owner may modify owners/admins, promote to admin/owner, or change permissions of admins.
  // A Super Admin with "Manage staff accounts" may change Staff accounts only.
  if (actor.role !== "OWNER" && targetRole !== "STAFF") throw Errors.forbidden(targetRole === "OWNER" || targetRole === "ADMIN" ? "Only the owner can change admins." : "Only the owner can change this account.");
  if (data.role && !canAssignRole(actor, data.role)) throw Errors.forbidden("Only the owner can assign this role.");
  if (target._id.toString() === actor.id && (data.role || data.status === "SUSPENDED")) throw Errors.badRequest("You can't change your own role or suspend yourself.");
  if (targetRole === "OWNER" && (data.role && data.role !== "OWNER" || data.status === "SUSPENDED")) {
    const owners = await User.countDocuments({ role: "OWNER", status: "ACTIVE" });
    if (owners <= 1) throw Errors.badRequest("There must always be at least one active owner.");
  }

  // Role and status only; permissions change through the grant policy below. A role change never adds access.
  const set: Record<string, unknown> = {};
  if (data.role) set.role = data.role;
  if (data.status) set.status = data.status;
  if (data.name) set.name = data.name;
  const roleChanged = !!data.role && data.role !== targetRole;
  const revokeSessions = data.status === "SUSPENDED" || roleChanged;
  if (Object.keys(set).length) await User.updateOne({ _id: target._id }, { $set: set, ...(revokeSessions && { $inc: { sessionVersion: 1 } }) });

  if (roleChanged) {
    await audit(actor, "user.role_changed", { entityType: "User", entityId: userId, metadata: { from: targetRole, to: data.role } });
    await applyRoleChange(actor, target._id, data.role!);
  }
  if (data.status) await audit(actor, data.status === "SUSPENDED" ? "user.suspended" : "user.reactivated", { entityType: "User", entityId: userId });
  if (data.permissions) {
    // Permissions are read from the database on every request, so no session revocation is needed.
    const fresh = await User.findById(target._id).select("role permissions permissionGrants").lean<UserDoc & { permissionGrants?: { permission: string }[] }>();
    const role = fresh!.role as Role;
    const current = new Set(effectivePermissions(role, fresh!.permissions, fresh!.permissionGrants));
    const wanted = new Set(data.permissions);
    for (const p of wanted) if (!current.has(p)) await changeAccess(actor, userId, { permission: p, action: "grant" });
    for (const p of current) if (!wanted.has(p)) await changeAccess(actor, userId, { permission: p, action: "revoke" });
  }
}

function requireOwner(actor: Actor) {
  if (actor.role !== "OWNER") throw Errors.forbidden("Only the owner can do this.");
}

/**
 * Permanently delete a team or client account (Owner only). Records the account worked on —
 * conversations, tickets, projects, audit history — are kept; only pointers that would leave work
 * assigned to nobody are cleared, and grants it delegated are re-checked (and removed).
 */
export async function deleteUserAccount(actor: Actor, userId: string) {
  requireOwner(actor);
  const id = parseObjectId(userId);
  if (String(id) === actor.id) throw Errors.badRequest("You can't delete your own account.");
  const target = await User.findById(id).select("name email role status organizationId").lean<UserDoc>();
  if (!target) throw Errors.notFound();
  if (target.role === "OWNER") {
    const owners = await User.countDocuments({ role: "OWNER", status: "ACTIVE", _id: { $ne: id } });
    if (owners < 1) throw Errors.badRequest("There must always be at least one active owner.");
  }

  await User.deleteOne({ _id: id });
  await Promise.all([
    Notification.deleteMany({ userId: id }),
    Conversation.updateMany({ "participants.userId": id }, { $pull: { participants: { userId: id } } }),
    ...[Company, ContactRequest, Conversation, FollowUp, SupportTicket].map((M) => (M as typeof Company).updateMany({ assignedTo: id }, { $unset: { assignedTo: 1 } })),
    ProjectTask.updateMany({ assigneeId: id }, { $unset: { assigneeId: 1 } }),
    Project.updateMany({ assignedStaff: id }, { $pull: { assignedStaff: id } }),
    Organization.updateMany({ accountManagerId: id }, { $unset: { accountManagerId: 1 } }),
  ]);
  await revalidateGrantsIssuedBy(id, actor);
  await audit(actor, "user.deleted", {
    entityType: "User",
    entityId: userId,
    organizationId: target.organizationId ? String(target.organizationId) : undefined,
    metadata: { name: target.name, email: target.email, role: target.role, status: target.status },
  });
}

export const convertClientSchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "STAFF", "DIGITAL_MARKETER"]),
  /** Starting access; defaults to the role's suggested template. */
  permissions: z.array(z.enum(PERMISSIONS)).optional(),
});

/**
 * Turn a client account into a team account with the chosen role (Owner only). The person leaves
 * their client organization (its records stay with the organization), is signed out everywhere,
 * and starts with the role's access like a newly added employee.
 */
export async function convertClientToTeamMember(actor: Actor, userId: string, input: unknown) {
  requireOwner(actor);
  const data = convertClientSchema.parse(input);
  const id = parseObjectId(userId);
  const target = await User.findById(id).select("name role organizationId").lean<UserDoc>();
  if (!target || target.role !== "CLIENT") throw Errors.notFound();
  if (!canAssignRole(actor, data.role)) throw Errors.forbidden("Only the owner can assign this role.");
  const requested: Permission[] = data.permissions ?? ROLE_TEMPLATES[data.role].filter((p) => grantDecision(actor, { id: userId, role: data.role }, p).ok);
  for (const p of requested) {
    const d = grantDecision(actor, { id: userId, role: data.role }, p);
    if (!d.ok) throw Errors.forbidden(d.reason);
  }

  const res = await User.updateOne(
    { _id: id, role: "CLIENT" },
    {
      $set: { role: data.role, status: "ACTIVE", permissions: [], permissionGrants: [], addedBy: new Types.ObjectId(actor.id), addedAt: new Date() },
      $unset: { organizationId: 1 },
      $inc: { sessionVersion: 1 },
    },
  );
  if (!res.modifiedCount) throw Errors.conflict("This account changed while it was being converted — please try again.");
  await Conversation.updateMany({ "participants.userId": id }, { $pull: { participants: { userId: id } } });
  const organizationId = target.organizationId ? String(target.organizationId) : undefined;
  await audit(actor, "user.converted_from_client", { entityType: "User", entityId: userId, organizationId, metadata: { from: "CLIENT", to: data.role, organizationId } });
  await grantInitialAccess(actor, id, data.role, requested);
  return { id: userId, role: data.role };
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
