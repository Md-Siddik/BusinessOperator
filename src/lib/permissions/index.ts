import { eligiblePermissions, PERMISSION_DEFS, PERMISSIONS, ROLE_TEMPLATES, ROLES, type Permission, type Role } from "./catalog";

export * from "./catalog";

/**
 * Access policy, evaluated server-side on every request (the actor is rebuilt from the
 * database per request, so a grant or revocation applies to the very next request).
 *
 *  - OWNER holds every permission by role.
 *  - Everyone else holds only what was explicitly granted (default deny). Grants are stored
 *    with their provenance on the account (`permissionGrants`, see features/access).
 *  - A grant only counts when the catalog says the permission is eligible for the role;
 *    Owner-only entries (Owner tools, CRM / outreach / registry syncs) never count for anyone else.
 *
 * Workspaces: OWNER → /dashboard · ADMIN, MANAGER, STAFF, DIGITAL_MARKETER → /staff · CLIENT → /portal.
 */
export { ROLES };
export type { Role, Permission };

/** Client-service team (OWNER, ADMIN, MANAGER, STAFF) — the roles that may work with client data when granted. */
export const INTERNAL_ROLES: Role[] = ["OWNER", "ADMIN", "MANAGER", "STAFF"];
/** Every employee account, including Digital Marketers (who never see client data). */
export const TEAM_ROLES: Role[] = ["OWNER", "ADMIN", "MANAGER", "STAFF", "DIGITAL_MARKETER"];

/** Role templates double as the access of accounts that predate per-user grants (see `effectivePermissions`). */
export const ROLE_DEFAULT_PERMISSIONS = ROLE_TEMPLATES;

/** Client-service permissions (pre-catalog name, kept for older imports). */
export const STAFF_AREA_PERMISSIONS = ["clients.manage", "chat.manage", "tickets.manage", "projects.manage", "content.manage", "services.manage"] as const satisfies readonly Permission[];
export const SUPER_ADMIN_PERMISSIONS: Permission[] = [...STAFF_AREA_PERMISSIONS, "users.manage", "analytics.view"];
/** Access to work explicitly assigned to a person — implicit for accounts that predate per-user grants. */
export const ASSIGNED_WORK_PERMISSIONS: Permission[] = ["conversations.assigned", "tickets.assigned", "projects.assigned"];

/**
 * What an account that has not been migrated to per-user grants may hold — exactly the access
 * it had before (staff-area lists plus assigned work). New scoped permissions (Opportunity
 * Intelligence, marketer leads) are only ever effective through a recorded grant.
 */
const LEGACY_ELIGIBLE: Partial<Record<Role, Permission[]>> = {
  ADMIN: [...SUPER_ADMIN_PERMISSIONS, ...ASSIGNED_WORK_PERMISSIONS],
  STAFF: [...STAFF_AREA_PERMISSIONS, ...ASSIGNED_WORK_PERMISSIONS],
};

export type Actor = {
  id: string;
  role: Role;
  permissions: Permission[];
  organizationId?: string;
  name: string;
  email: string;
};

export function isInternal(actor: Pick<Actor, "role"> | null | undefined): boolean {
  return !!actor && INTERNAL_ROLES.includes(actor.role);
}

/** Any employee account (Owner, Admin, Manager, Staff, Digital Marketer). */
export function isTeamMember(actor: Pick<Actor, "role"> | null | undefined): boolean {
  return !!actor && TEAM_ROLES.includes(actor.role);
}

/** ADMIN, MANAGER or STAFF — client-service users of the team workspace. */
export function isStaffMember(actor: Pick<Actor, "role"> | null | undefined): boolean {
  return actor?.role === "ADMIN" || actor?.role === "MANAGER" || actor?.role === "STAFF";
}

export function isDigitalMarketer(actor: Pick<Actor, "role"> | null | undefined): boolean {
  return actor?.role === "DIGITAL_MARKETER";
}

/**
 * Owner-only areas (Owner tools, CRM / outreach) are gated on the account's actual
 * role — never on a grantable permission — so they can't be delegated through any editor or API.
 */
export function isOwner(actor: Pick<Actor, "role"> | null | undefined): boolean {
  return actor?.role === "OWNER";
}

export function isClient(actor: Pick<Actor, "role"> | null | undefined): boolean {
  return actor?.role === "CLIENT";
}

type StoredGrant = { permission?: string | null };

/**
 * Effective permissions of an account.
 *  - `grants` present (array, possibly empty): the union of granted permissions eligible for the role.
 *  - `grants` absent: an account from before per-user grants — keeps its previous access
 *    (stored list, or the role template when empty) limited to what that model allowed.
 */
export function effectivePermissions(role: Role, stored?: string[] | null, grants?: StoredGrant[] | null): Permission[] {
  if (role === "OWNER") return [...PERMISSIONS];
  if (role === "CLIENT" || !(ROLES as readonly string[]).includes(role)) return [];
  if (Array.isArray(grants)) {
    const eligible = eligiblePermissions(role);
    const held = new Set(grants.map((g) => g.permission));
    return eligible.filter((p) => held.has(p));
  }
  const legacy = LEGACY_ELIGIBLE[role];
  if (!legacy) return [];
  const source = new Set<string>(stored && stored.length > 0 ? stored : ROLE_TEMPLATES[role]);
  for (const p of ASSIGNED_WORK_PERMISSIONS) source.add(p);
  return legacy.filter((p) => source.has(p));
}

export function can(actor: Actor | null | undefined, permission: Permission): boolean {
  if (!actor) return false;
  if (actor.role === "OWNER") return true;
  if (actor.role === "CLIENT") return false;
  // Defence in depth: Owner-only entries never count for another role, whatever the actor object says.
  const def = PERMISSION_DEFS[permission];
  if (!def || def.ownerOnly || !def.eligibleRoles.includes(actor.role)) return false;
  return actor.permissions.includes(permission);
}

export function canAny(actor: Actor | null | undefined, permissions: Permission[]) {
  return permissions.some((p) => can(actor, p));
}

/** Owner assigns every role; an Admin with "Manage staff accounts" may create / assign STAFF only. */
export function canAssignRole(actor: Actor, targetRole: Role): boolean {
  if (targetRole === "CLIENT") return false;
  return (actor.role === "OWNER" && (ROLES as readonly string[]).includes(targetRole)) || (actor.role === "ADMIN" && can(actor, "users.manage") && targetRole === "STAFF");
}
