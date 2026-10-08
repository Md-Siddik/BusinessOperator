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

export const ROLE_DEFAULT_PERMISSIONS: Record<Role, Permission[]> = {
  OWNER: [...PERMISSIONS],
  ADMIN: PERMISSIONS.filter((p) => p !== "users.manage" && p !== "settings.manage"),
  STAFF: ["companies.read", "outreach.manage", "analytics.view"],
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

export function isClient(actor: Pick<Actor, "role"> | null | undefined): boolean {
  return actor?.role === "CLIENT";
}

export function effectivePermissions(role: Role, stored?: string[] | null): Permission[] {
  if (role === "OWNER") return [...PERMISSIONS];
  if (role === "CLIENT") return [];
  const source = stored && stored.length > 0 ? stored : ROLE_DEFAULT_PERMISSIONS[role];
  return source.filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p));
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

/** Only the Owner may create/promote/remove admins or other owners. */
export function canAssignRole(actor: Actor, targetRole: Role): boolean {
  if (actor.role === "OWNER") return true;
  if (!can(actor, "users.manage")) return false;
  return targetRole === "STAFF" || targetRole === "CLIENT";
}
