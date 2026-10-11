/**
 * Role-based access control. Roles carry DEFAULT permission sets; ADMIN and
 * STAFF users may have an explicit permission list stored on their account
 * (editable by the Owner). OWNER always has every permission.
 *
 * Authorization is always evaluated server-side, via the service layer.
 */
export const ROLES = ["OWNER", "ADMIN", "STAFF", "CLIENT"] as const;
export type Role = (typeof ROLES)[number];
export const INTERNAL_ROLES: Role[] = ["OWNER", "ADMIN", "STAFF"];

export const PERMISSIONS = [
  "companies.read",
  "companies.edit",
  "companies.export",
  "leads.manage",
  "outreach.manage",
  "outreach.approve",
  "clients.manage",
  "users.manage",
  "analytics.view",
  "content.manage",
  "registry.sync",
  "chat.manage",
  "tickets.manage",
  "projects.manage",
  "settings.manage",
  "audit.view",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "companies.read": "View company intelligence",
  "companies.edit": "Edit companies",
  "companies.export": "Export company data (CSV)",
  "leads.manage": "Manage all leads (not only assigned)",
  "outreach.manage": "Create outreach drafts, templates & campaigns",
  "outreach.approve": "Approve & send outreach",
  "clients.manage": "Manage clients & approvals",
  "users.manage": "Manage internal users",
  "analytics.view": "View analytics",
  "content.manage": "Manage website content & translations",
  "registry.sync": "Run registry syncs",
  "chat.manage": "Access all client conversations",
  "tickets.manage": "Manage all requests & tickets",
  "projects.manage": "Manage all projects",
  "settings.manage": "Manage system settings",
  "audit.view": "View audit logs",
};

/**
 * Access model:
 *  - OWNER  → the owner dashboard (/dashboard): everything, including every internal API.
 *  - ADMIN / STAFF → the staff workspace (/staff): client data and website maintenance only.
 *    They can never hold company-intelligence, CRM, outreach, analytics, user or system
 *    permissions — `effectivePermissions` filters to this list whatever is stored.
 *  - CLIENT → the client portal (/portal).
 */
export const STAFF_AREA_PERMISSIONS = ["clients.manage", "chat.manage", "tickets.manage", "projects.manage", "content.manage"] as const satisfies readonly Permission[];

export const ROLE_DEFAULT_PERMISSIONS: Record<Role, Permission[]> = {
  OWNER: [...PERMISSIONS],
  ADMIN: [...STAFF_AREA_PERMISSIONS],
  STAFF: ["chat.manage", "tickets.manage", "projects.manage", "content.manage"],
  CLIENT: [],
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

/** ADMIN or STAFF — users of the staff workspace. */
export function isStaffMember(actor: Pick<Actor, "role"> | null | undefined): boolean {
  return actor?.role === "ADMIN" || actor?.role === "STAFF";
}

/**
 * Owner-only areas (e.g. Verified Opportunity Intelligence) are gated on the
 * account's actual role — deliberately NOT a grantable permission, so it can
 * never be delegated to ADMIN/STAFF through the permission editor.
 */
export function isOwner(actor: Pick<Actor, "role"> | null | undefined): boolean {
  return actor?.role === "OWNER";
}

export function isClient(actor: Pick<Actor, "role"> | null | undefined): boolean {
  return actor?.role === "CLIENT";
}

export function effectivePermissions(role: Role, stored?: string[] | null): Permission[] {
  if (role === "OWNER") return [...PERMISSIONS];
  if (role === "CLIENT") return [];
  const source = stored && stored.length > 0 ? stored : ROLE_DEFAULT_PERMISSIONS[role];
  // Staff can only ever hold staff-area permissions (older stored lists may contain more).
  return source.filter((p): p is Permission => (STAFF_AREA_PERMISSIONS as readonly string[]).includes(p));
}

export function can(actor: Actor | null | undefined, permission: Permission): boolean {
  if (!actor) return false;
  if (actor.role === "OWNER") return true;
  if (actor.role === "CLIENT") return false;
  return actor.permissions.includes(permission);
}

export function canAny(actor: Actor | null | undefined, permissions: Permission[]) {
  return permissions.some((p) => can(actor, p));
}

/** Only the Owner manages internal users and roles. */
export function canAssignRole(actor: Actor, targetRole: Role): boolean {
  return actor.role === "OWNER" && (ROLES as readonly string[]).includes(targetRole);
}
