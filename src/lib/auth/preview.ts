import "server-only";
import { effectivePermissions, PERMISSION_LABELS, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, type Permission, type Role } from "@/lib/permissions";
import { getRoleTemplates } from "@/features/access/service";
import { isActiveSessionUser, type SessionUser } from "./actor";
import { isPreviewableRole, type PreviewPayload, type SessionPayload } from "./token";

/**
 * "View as Role" — one central place that decides what a previewing Owner is for this request.
 *
 *  - Only an active OWNER session with a preview token issued to that same account and session
 *    version is affected; any other combination is ignored (the Owner stays the Owner).
 *  - The account identity never changes: id, name, email and the session cookie are the Owner's.
 *    Only the effective `role` and the actor's permissions are replaced — with the role template's
 *    *current* permissions (read from the database on every request), limited to what the catalog
 *    lets that role hold. Every existing guard, navigation builder and API check then applies
 *    unchanged, so the preview can never see more than the role would.
 *  - Data scoped to "own" records (assigned work, own leads) resolves to the Owner's own account,
 *    so no other user's private records are shown. A previewed Client gets an organization id that
 *    matches nothing, so client-scoped queries return empty states, never a real client's data.
 *  - The API layer refuses every state-changing request while a preview is active (read-only).
 */

/** Matches no organization — client-scoped queries in a Client preview are always empty. */
export const PREVIEW_ORGANIZATION_ID = "000000000000000000000000";

export function isPreviewOrganization(id: string | undefined | null) {
  return id === PREVIEW_ORGANIZATION_ID;
}

/** Home of the workspace a role signs in to. */
export function workspaceFor(role: Role) {
  return role === "OWNER" ? "/dashboard" : role === "CLIENT" ? "/portal" : "/staff";
}

/** The permissions a role's preview runs with: its role template, as stored right now. */
export async function previewPermissions(role: Role): Promise<Permission[]> {
  if (role === "CLIENT") return [];
  const templates = await getRoleTemplates();
  return effectivePermissions(role, [], (templates[role] ?? []).map((permission) => ({ permission })));
}

export async function applyRolePreview(user: SessionUser | null, session: SessionPayload | null, preview: PreviewPayload | null): Promise<SessionUser | null> {
  if (!user || !session || !preview) return user;
  if (user.role !== "OWNER" || !isActiveSessionUser(user)) return user;
  if (preview.sub !== user.id || session.sub !== user.id || preview.sv !== session.sv) return user;
  if (!isPreviewableRole(preview.role)) return user;
  const role = preview.role;
  const client = role === "CLIENT";
  const permissions = await previewPermissions(role);
  return {
    ...user,
    role,
    organizationId: client ? PREVIEW_ORGANIZATION_ID : undefined,
    organizationStatus: client ? "ACTIVE" : undefined,
    actor: { ...user.actor, role, permissions, organizationId: client ? PREVIEW_ORGANIZATION_ID : undefined },
    preview: { role, label: ROLE_LABELS[role], realRole: user.role },
  };
}

/** The real role behind the session, whether or not a preview is active. */
export function realRoleOf(user: Pick<SessionUser, "role" | "preview"> | null | undefined): Role | undefined {
  return user?.preview?.realRole ?? user?.role;
}

export type PreviewRoleOption = { role: Role; label: string; description: string; workspace: string; permissions: { key: Permission; label: string }[] };

/**
 * Every role the Owner can preview, read from the role catalog and the stored role templates —
 * a role added to the catalog, or a template the Owner edits, shows up here without code changes.
 */
export async function listPreviewRoles(): Promise<PreviewRoleOption[]> {
  const roles = ROLES.filter(isPreviewableRole);
  const perms = await Promise.all(roles.map(previewPermissions));
  return roles.map((role, i) => ({
    role,
    label: ROLE_LABELS[role],
    description: ROLE_DESCRIPTIONS[role],
    workspace: workspaceFor(role),
    permissions: perms[i].map((key) => ({ key, label: PERMISSION_LABELS[key] ?? key })),
  }));
}
