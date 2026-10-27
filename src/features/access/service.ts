import "server-only";
import { Types } from "mongoose";
import { z } from "zod";
import { LeadAssignment, User, type GrantOrigin, type UserDoc } from "@/models";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { toActor } from "@/lib/auth/actor";
import {
  can,
  canAssignRole,
  effectivePermissions,
  isOwner,
  PERMISSION_CATALOG,
  PERMISSION_DEFS,
  PERMISSIONS,
  ROLE_LABELS,
  ROLE_TEMPLATES,
  SCOPED_GRANT_AUTHORITIES,
  TEAM_ROLES,
  type Actor,
  type Permission,
  type PermissionDef,
  type Role,
} from "@/lib/permissions";
import { parseObjectId } from "@/lib/validation";

/**
 * Per-user permission grants with provenance.
 *
 * Policy (documented in docs/access-control.md):
 *  1. Default deny. A non-Owner holds a permission while at least one recorded grant exists and
 *     the catalog makes it eligible for their role.
 *  2. The Owner may grant any eligible permission to any team member. Owner-only entries —
 *     Company Intelligence above all — can't be granted by anyone, whatever the payload says.
 *  3. A Super Admin may grant a permission only through the one scoped authority the catalog
 *     names for it (`delegatedBy`), only to the roles it allows, and — where `grantorMustHold` —
 *     only while holding the permission too. Authority never implies any other grant right.
 *  4. Grants made through a scoped grant authority (Opportunity Intelligence, marketer leads)
 *     depend on it: when the grantor loses that authority (or the permission they had to hold),
 *     those grants are revoked and audited. Independent Owner grants are never touched.
 *  5. Owner grants can only be removed by the Owner.
 */

type GrantDoc = { permission: string; grantedBy?: Types.ObjectId | null; grantedByRole?: string | null; origin: GrantOrigin; via?: string | null; grantedAt: Date };
type TargetUser = Pick<UserDoc, "_id" | "name" | "email" | "role" | "status" | "permissions" | "lastLoginAt" | "isDemo"> & { permissionGrants?: GrantDoc[] | null };
type Target = { id: string; role: Role };

export type Decision = { ok: true; origin: GrantOrigin; via?: Permission } | { ok: false; reason: string };

const label = (p: Permission) => PERMISSION_DEFS[p]?.label ?? p;

function baseCheck(actor: Actor, target: Target, def: PermissionDef | undefined): string | null {
  if (!def) return "Unknown permission.";
  if (def.companyIntelligence) return "Company Intelligence is Owner-only and can't be granted to anyone.";
  if (def.ownerOnly) return `“${def.label}” is an Owner-only feature and can't be granted.`;
  if (target.role === "OWNER") return "The Owner always has full access.";
  if (!TEAM_ROLES.includes(target.role)) return "Client accounts can't receive team permissions.";
  if (target.id === actor.id) return "You can't change your own access.";
  return null;
}

/** May `actor` grant `permission` to `target`? Pure — evaluated against the actor's current permissions. */
export function grantDecision(actor: Actor, target: Target, permission: Permission): Decision {
  const def = PERMISSION_DEFS[permission];
  const base = baseCheck(actor, target, def);
  if (base) return { ok: false, reason: base };
  if (!def.eligibleRoles.includes(target.role)) return { ok: false, reason: `“${def.label}” isn't available for the ${ROLE_LABELS[target.role]} role.` };
  if (isOwner(actor)) return { ok: true, origin: "OWNER" };
  if (actor.role !== "ADMIN" || !def.delegatedBy) return { ok: false, reason: `Only the Owner can grant “${def.label}”.` };
  if (!can(actor, def.delegatedBy)) return { ok: false, reason: `Granting “${def.label}” requires the “${label(def.delegatedBy)}” permission from the Owner.` };
  if (def.grantorMustHold && !can(actor, permission)) return { ok: false, reason: `You can grant “${def.label}” only while you hold it yourself.` };
  const targets = def.delegateTargets ?? def.eligibleRoles;
  if (!targets.includes(target.role)) return { ok: false, reason: `You can grant “${def.label}” only to ${targets.map((r) => ROLE_LABELS[r]).join(" or ")} accounts.` };
  return { ok: true, origin: "DELEGATED", via: def.delegatedBy };
}

/** May `actor` remove `permission` from `target`? Delegates never remove Owner grants. */
export function revokeDecision(actor: Actor, target: Target, permission: Permission): { ok: true; ownerScope: boolean } | { ok: false; reason: string } {
  const def = PERMISSION_DEFS[permission];
  const base = baseCheck(actor, target, def);
  if (base) return { ok: false, reason: base };
  if (isOwner(actor)) return { ok: true, ownerScope: true };
  if (actor.role !== "ADMIN" || !def.delegatedBy || !can(actor, def.delegatedBy)) return { ok: false, reason: `Only the Owner can remove “${def.label}”.` };
  if (def.grantorMustHold && !can(actor, permission)) return { ok: false, reason: `You can remove “${def.label}” only while you hold it yourself.` };
  const targets = def.delegateTargets ?? def.eligibleRoles;
  if (!targets.includes(target.role)) return { ok: false, reason: `You can manage “${def.label}” only for ${targets.map((r) => ROLE_LABELS[r]).join(" or ")} accounts.` };
  return { ok: true, ownerScope: false };
}

/* ───────────────────────── Storage (atomic, single-document) ───────────────────────── */

const RECOMPUTE_MIRROR = { $set: { permissions: { $setUnion: [{ $ifNull: ["$permissionGrants.permission", []] }, []] } } };

/**
 * Accounts created before per-user grants keep exactly their previous access: it is written
 * down as MIGRATION grants (no grantor) before the first change. Idempotent and race-safe.
 */
export async function ensureGrantsRecorded(userId: Types.ObjectId | string) {
  const u = await User.findById(userId).select("role permissions permissionGrants").lean<TargetUser>();
  if (!u || Array.isArray(u.permissionGrants) || u.role === "OWNER" || u.role === "CLIENT") return;
  const perms = effectivePermissions(u.role as Role, u.permissions, undefined);
  const now = new Date();
  await User.updateOne(
    { _id: u._id, permissionGrants: { $exists: false } },
    { $set: { permissionGrants: perms.map((permission) => ({ permission, grantedBy: null, origin: "MIGRATION", grantedAt: now })), permissions: perms } },
  );
}

async function pushGrant(userId: Types.ObjectId, grant: GrantDoc) {
  // The filter makes the write idempotent: the same grantor never stores the same grant twice.
  // Native driver: pipeline updates and $not/$elemMatch are passed through without schema casting.
  const res = await User.collection.updateOne({ _id: userId, permissionGrants: { $not: { $elemMatch: { permission: grant.permission, grantedBy: grant.grantedBy } } } }, [
    { $set: { permissionGrants: { $concatArrays: [{ $ifNull: ["$permissionGrants", []] }, [{ $literal: grant }]] } } },
    RECOMPUTE_MIRROR,
  ]);
  return res.modifiedCount > 0;
}

/** Remove grants of `permission` matching `extra` (an aggregation condition on `$$g`). Returns the removed grants. */
async function pullGrants(userId: Types.ObjectId, permission: string, extra?: Record<string, unknown>) {
  const before = await User.findById(userId).select("permissionGrants").lean<{ permissionGrants?: GrantDoc[] }>();
  const cond = extra ? { $and: [{ $eq: ["$$g.permission", permission] }, extra] } : { $eq: ["$$g.permission", permission] };
  await User.collection.updateOne({ _id: userId }, [{ $set: { permissionGrants: { $filter: { input: { $ifNull: ["$permissionGrants", []] }, as: "g", cond: { $not: [cond] } } } } }, RECOMPUTE_MIRROR]);
  const after = await User.findById(userId).select("permissionGrants").lean<{ permissionGrants?: GrantDoc[] }>();
  const kept = new Set((after?.permissionGrants ?? []).map((g) => `${g.permission}|${g.grantedBy ?? ""}|${g.origin}`));
  return (before?.permissionGrants ?? []).filter((g) => g.permission === permission && !kept.has(`${g.permission}|${g.grantedBy ?? ""}|${g.origin}`));
}

async function loadTarget(userId: string) {
  const target = await User.findById(parseObjectId(userId)).select("name email role status permissions permissionGrants lastLoginAt isDemo").lean<TargetUser>();
  if (!target || !TEAM_ROLES.includes(target.role as Role)) throw Errors.notFound();
  return target;
}

/** The actor as currently stored (a grant decided on a stale actor is re-checked after the write). */
async function freshActor(actorId: string) {
  const u = await User.findById(actorId).select("name email role permissions permissionGrants organizationId status").lean<UserDoc & { permissionGrants?: GrantDoc[] }>();
  return u && u.status === "ACTIVE" ? toActor(u) : null;
}

/* ───────────────────────── Grant / revoke ───────────────────────── */

export const accessChangeSchema = z.object({
  permission: z.enum(PERMISSIONS),
  action: z.enum(["grant", "revoke"]),
});

export async function changeAccess(actor: Actor, userId: string, input: unknown) {
  const { permission, action } = accessChangeSchema.parse(input);
  const target = await loadTarget(userId);
  const t: Target = { id: String(target._id), role: target.role as Role };
  if (action === "grant") await grant(actor, target, t, permission);
  else await revoke(actor, target, t, permission);
  const [view] = await buildViews(actor, [await loadTarget(userId)]);
  return view!;
}

async function grant(actor: Actor, target: TargetUser, t: Target, permission: Permission) {
  const d = grantDecision(actor, t, permission);
  if (!d.ok) throw Errors.forbidden(d.reason);
  await ensureGrantsRecorded(target._id);
  const added = await pushGrant(target._id, { permission, grantedBy: new Types.ObjectId(actor.id), grantedByRole: actor.role, origin: d.origin, via: d.via ?? null, grantedAt: new Date() });
  if (!added) return; // retry / double click: already granted by this person
  if (d.origin === "DELEGATED") {
    // The grantor's authority may have been revoked while this request ran — re-check after the write.
    const now = await freshActor(actor.id);
    if (!now || !grantDecision(now, t, permission).ok) {
      await pullGrants(target._id, permission, { $eq: ["$$g.grantedBy", new Types.ObjectId(actor.id)] });
      throw Errors.conflict("Your access changed while saving — nothing was granted.");
    }
  }
  await audit(actor, "permission.granted", { entityType: "User", entityId: t.id, metadata: { permission, targetRole: t.role, origin: d.origin, via: d.via } });
  if (permission === "marketerLeads.view") await notifyLeadsVisible(target._id);
}

async function revoke(actor: Actor, target: TargetUser, t: Target, permission: Permission) {
  const d = revokeDecision(actor, t, permission);
  if (!d.ok) throw Errors.forbidden(d.reason);
  await ensureGrantsRecorded(target._id);
  const removed = await pullGrants(target._id, permission, d.ownerScope ? undefined : { $ne: ["$$g.origin", "OWNER"] });
  if (!removed.length) {
    const stillHeld = (await User.exists({ _id: target._id, "permissionGrants.permission": permission })) !== null;
    if (stillHeld) throw Errors.forbidden(`“${label(permission)}” was granted by the Owner — only the Owner can remove it.`);
    return; // already removed (retry)
  }
  await audit(actor, "permission.revoked", { entityType: "User", entityId: t.id, metadata: { permission, targetRole: t.role, removedGrants: removed.map(describeGrant) } });
  await revalidateGrantsIssuedBy(target._id, actor);
}

function describeGrant(g: GrantDoc) {
  return { origin: g.origin, via: g.via ?? undefined, grantedBy: g.grantedBy ? String(g.grantedBy) : undefined, grantedAt: g.grantedAt };
}

/**
 * Cascade (policy rule 4): grants that `grantorId` issued through a scoped grant authority are
 * removed when the grantor no longer holds that authority (or the permission they had to hold).
 * Runs recursively — a removed grant may have been the basis of further grants. Audited per grant.
 */
export async function revalidateGrantsIssuedBy(grantorId: Types.ObjectId | string, trigger: Actor | null, seen = new Set<string>()): Promise<number> {
  const key = String(grantorId);
  if (seen.has(key)) return 0;
  seen.add(key);
  const grantor = await User.findById(grantorId).select("name email role permissions permissionGrants organizationId").lean<UserDoc & { permissionGrants?: GrantDoc[] }>();
  const grantorActor = grantor ? toActor(grantor) : null;
  const holders = await User.find({ permissionGrants: { $elemMatch: { grantedBy: new Types.ObjectId(key), via: { $in: SCOPED_GRANT_AUTHORITIES } } } })
    .select("role permissionGrants")
    .lean<TargetUser[]>();
  let removedCount = 0;
  for (const h of holders) {
    for (const g of h.permissionGrants ?? []) {
      if (String(g.grantedBy) !== key || !g.via || !SCOPED_GRANT_AUTHORITIES.includes(g.via as Permission)) continue;
      const def = PERMISSION_DEFS[g.permission as Permission];
      const valid = !!grantorActor && grantorActor.role === "ADMIN" && !!def && can(grantorActor, g.via as Permission) && (!def.grantorMustHold || can(grantorActor, def.key));
      if (valid) continue;
      const removed = await pullGrants(h._id, g.permission, { $and: [{ $eq: ["$$g.grantedBy", new Types.ObjectId(key)] }, { $eq: ["$$g.via", g.via] }] });
      if (!removed.length) continue;
      removedCount += removed.length;
      await audit(trigger, "permission.revoked", {
        entityType: "User",
        entityId: String(h._id),
        metadata: { permission: g.permission, targetRole: h.role, reason: "CASCADE_GRANTOR_LOST_AUTHORITY", grantor: key, removedGrants: removed.map(describeGrant) },
      });
      removedCount += await revalidateGrantsIssuedBy(h._id, trigger, seen);
    }
  }
  return removedCount;
}

/** After a role change: drop grants the new role can't hold (never adds any), then cascade. */
export async function applyRoleChange(actor: Actor, userId: Types.ObjectId, newRole: Role) {
  await ensureGrantsRecorded(userId);
  const u = await User.findById(userId).select("permissionGrants").lean<{ permissionGrants?: GrantDoc[] }>();
  const eligible = new Set(newRole === "OWNER" ? PERMISSIONS : PERMISSION_CATALOG.filter((d) => !d.ownerOnly && d.eligibleRoles.includes(newRole)).map((d) => d.key));
  for (const p of new Set((u?.permissionGrants ?? []).map((g) => g.permission))) {
    if (eligible.has(p as Permission)) continue;
    const removed = await pullGrants(userId, p);
    if (removed.length) await audit(actor, "permission.revoked", { entityType: "User", entityId: String(userId), metadata: { permission: p, targetRole: newRole, reason: "ROLE_CHANGED", removedGrants: removed.map(describeGrant) } });
  }
  await revalidateGrantsIssuedBy(userId, actor);
}

/** Initial grants for a new account; every one is checked like an individual grant. */
export async function grantInitialAccess(actor: Actor, userId: Types.ObjectId, role: Role, permissions: Permission[]) {
  await User.updateOne({ _id: userId, permissionGrants: { $exists: false } }, { $set: { permissionGrants: [], permissions: [] } });
  const t: Target = { id: String(userId), role };
  for (const p of new Set(permissions)) {
    const d = grantDecision(actor, t, p);
    if (!d.ok) throw Errors.forbidden(d.reason);
  }
  for (const p of new Set(permissions)) {
    const d = grantDecision(actor, t, p) as Extract<Decision, { ok: true }>;
    await pushGrant(userId, { permission: p, grantedBy: new Types.ObjectId(actor.id), grantedByRole: actor.role, origin: d.origin, via: d.via ?? null, grantedAt: new Date() });
    await audit(actor, "permission.granted", { entityType: "User", entityId: t.id, metadata: { permission: p, targetRole: role, origin: d.origin, via: d.via, initial: true } });
  }
}

async function notifyLeadsVisible(userId: Types.ObjectId) {
  const waiting = await LeadAssignment.countDocuments({ recipientId: userId, status: "ACTIVE" });
  if (!waiting) return;
  const { notifyUsers } = await import("@/features/notifications/service");
  await notifyUsers([String(userId)], { type: "ACCOUNT", title: "Client leads are now visible", body: `${waiting} lead${waiting === 1 ? "" : "s"} sent to you can now be opened.`, link: "/staff/client-leads" }).catch(() => undefined);
}

/* ───────────────────────── Read model for the Permission Management page ───────────────────────── */

export type AccessRow = {
  key: Permission;
  held: boolean;
  /** Who granted it — every recorded grant. */
  sources: { origin: GrantOrigin; by?: string; byRole?: string; at?: string; via?: string }[];
  canGrant: boolean;
  canRevoke: boolean;
  /** Held only through delegated / existing grants: the Owner can add an independent Owner grant (survives cascades). */
  canConfirm: boolean;
  /** Why the control is locked, in plain language. */
  lockedReason?: string;
};

export type AccessUserView = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: string;
  isDemo: boolean;
  lastLoginAt?: string;
  isSelf: boolean;
  /** Effective permissions (what this account can use right now). */
  effective: Permission[];
  rows: AccessRow[];
  /** Leads sent to a Digital Marketer that stay hidden until "View Assigned Client Leads" is granted. */
  waitingLeads?: number;
  migrated: boolean;
};

/** Delegation authorities that open the Permission Management page for a Super Admin. */
export const ACCESS_MANAGER_PERMISSIONS: Permission[] = ["users.manage", "opportunities.grant", "marketerLeads.grant"];

export function canOpenAccessManager(actor: Actor) {
  return isOwner(actor) || (actor.role === "ADMIN" && ACCESS_MANAGER_PERMISSIONS.some((p) => can(actor, p)));
}

/** Catalog rows this actor may act on (Owner: everything grantable plus the locked Owner-only list). */
export function visibleCatalog(actor: Actor): PermissionDef[] {
  if (isOwner(actor)) return PERMISSION_CATALOG;
  return PERMISSION_CATALOG.filter((d) => d.delegatedBy && can(actor, d.delegatedBy) && (!d.grantorMustHold || can(actor, d.key)));
}

/** Roles of the accounts this actor may manage at all. */
function manageableRoles(actor: Actor): Role[] {
  if (isOwner(actor)) return ["OWNER", "ADMIN", "STAFF", "DIGITAL_MARKETER"];
  const roles = new Set<Role>();
  for (const d of visibleCatalog(actor)) for (const r of d.delegateTargets ?? d.eligibleRoles) roles.add(r);
  return [...roles];
}

export async function listAccess(actor: Actor, opts: { q?: string } = {}) {
  if (!canOpenAccessManager(actor)) throw Errors.forbidden();
  const roles = manageableRoles(actor);
  const filter: Record<string, unknown> = { role: { $in: roles } };
  if (!isOwner(actor)) filter._id = { $ne: new Types.ObjectId(actor.id) };
  if (opts.q) {
    const { escapeRegex } = await import("@/lib/utils");
    filter.$or = [{ name: new RegExp(escapeRegex(opts.q), "i") }, { email: new RegExp(escapeRegex(opts.q), "i") }];
  }
  const users = await User.find(filter).select("name email role status permissions permissionGrants lastLoginAt isDemo").sort({ role: 1, name: 1 }).limit(500).lean<TargetUser[]>();
  return buildViews(actor, users);
}

export async function getAccess(actor: Actor, userId: string) {
  if (!canOpenAccessManager(actor)) throw Errors.forbidden();
  const target = await loadTarget(userId);
  if (!manageableRoles(actor).includes(target.role as Role) || (!isOwner(actor) && String(target._id) === actor.id)) throw Errors.notFound();
  const [view] = await buildViews(actor, [target]);
  return view!;
}

async function buildViews(actor: Actor, users: TargetUser[]): Promise<AccessUserView[]> {
  const grantorIds = [...new Set(users.flatMap((u) => (u.permissionGrants ?? []).map((g) => (g.grantedBy ? String(g.grantedBy) : null)).filter(Boolean) as string[]))];
  const grantors = grantorIds.length ? await User.find({ _id: { $in: grantorIds } }).select("name role").lean<{ _id: Types.ObjectId; name: string; role: string }[]>() : [];
  const names = new Map(grantors.map((g) => [String(g._id), g]));
  const marketerIds = users.filter((u) => u.role === "DIGITAL_MARKETER").map((u) => u._id);
  const showWaiting = isOwner(actor) || can(actor, "marketerLeads.grant");
  const waiting = showWaiting && marketerIds.length ? await LeadAssignment.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { recipientId: { $in: marketerIds }, status: "ACTIVE" } }, { $group: { _id: "$recipientId", n: { $sum: 1 } } }]) : [];
  const waitingBy = new Map(waiting.map((w) => [String(w._id), w.n]));
  const catalog = visibleCatalog(actor);

  return users.map((u) => {
    const role = u.role as Role;
    const migrated = Array.isArray(u.permissionGrants);
    const effective = effectivePermissions(role, u.permissions, u.permissionGrants);
    // Accounts from before per-user grants show their current access as "existing access".
    const grants: GrantDoc[] = migrated ? u.permissionGrants! : effective.map((permission) => ({ permission, origin: "MIGRATION" as const, grantedAt: u.lastLoginAt ?? new Date(0) }));
    const t: Target = { id: String(u._id), role };
    const rows: AccessRow[] = catalog.map((def) => {
      const own = grants.filter((g) => g.permission === def.key);
      const held = role === "OWNER" || effective.includes(def.key);
      const g = grantDecision(actor, t, def.key);
      const r = revokeDecision(actor, t, def.key);
      const onlyOwnerGrants = own.length > 0 && own.every((x) => x.origin === "OWNER");
      const canRevoke = held && role !== "OWNER" && r.ok && (r.ownerScope || !onlyOwnerGrants);
      let lockedReason: string | undefined;
      if (role === "OWNER") lockedReason = "The Owner always has full access.";
      else if (def.companyIntelligence) lockedReason = "Company Intelligence is Owner-only — it can never be granted.";
      else if (def.ownerOnly) lockedReason = "Owner-only feature — it can't be granted.";
      else if (held && !canRevoke) lockedReason = !r.ok ? r.reason : "Granted by the Owner — only the Owner can remove it.";
      else if (!held && !g.ok) lockedReason = g.reason;
      return {
        key: def.key,
        held,
        sources: own.map((x) => {
          const by = x.grantedBy ? names.get(String(x.grantedBy)) : undefined;
          return { origin: x.origin, by: by?.name, byRole: by ? ROLE_LABELS[by.role as Role] : undefined, at: x.grantedAt ? new Date(x.grantedAt).toISOString() : undefined, via: x.via ?? undefined };
        }),
        canGrant: !held && g.ok,
        canRevoke,
        canConfirm: held && role !== "OWNER" && isOwner(actor) && g.ok && !own.some((x) => x.origin === "OWNER"),
        lockedReason,
      };
    });
    return {
      id: String(u._id),
      name: u.name,
      email: u.email,
      role,
      status: u.status,
      isDemo: !!u.isDemo,
      lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : undefined,
      isSelf: String(u._id) === actor.id,
      effective: role === "OWNER" ? [...PERMISSIONS] : effective,
      rows,
      waitingLeads: role === "DIGITAL_MARKETER" && showWaiting ? (waitingBy.get(String(u._id)) ?? 0) : undefined,
      migrated,
    };
  });
}

/** What the Permission Management page lets this person do with accounts (create / edit / starting access). */
export function accountAbilities(actor: Actor) {
  const roles: Role[] = ["ADMIN", "STAFF", "DIGITAL_MARKETER", "OWNER"];
  const mayManageAccounts = isOwner(actor) || can(actor, "users.manage");
  const assignableRoles = mayManageAccounts ? roles.filter((r) => canAssignRole(actor, r)) : [];
  const editableRoles: Role[] = isOwner(actor) ? roles : can(actor, "users.manage") ? ["STAFF"] : [];
  const grantable: Partial<Record<Role, Permission[]>> = {};
  const templates: Partial<Record<Role, Permission[]>> = {};
  for (const r of assignableRoles) {
    grantable[r] = PERMISSIONS.filter((p) => grantDecision(actor, { id: "new-account", role: r }, p).ok);
    templates[r] = ROLE_TEMPLATES[r].filter((p) => grantable[r]!.includes(p));
  }
  return { assignableRoles, editableRoles, grantable, templates };
}
