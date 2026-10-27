import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { can, canAny, isInternal, isOwner, isTeamMember, type Actor, type Permission } from "@/lib/permissions";
import { isActiveSessionUser, loadSessionUser } from "./actor";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, signSession, verifySession, type SessionPayload } from "./token";

export async function setSessionCookie(payload: SessionPayload) {
  const token = await signSession(payload);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(0, Math.min(SESSION_MAX_AGE_SECONDS, (payload.st ?? Math.floor(Date.now() / 1000)) + 30 * 86400 - Math.floor(Date.now() / 1000))),
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/** Current session user (any account status), memoised per request. */
export const getSessionUser = cache(async () => {
  const jar = await cookies();
  const payload = await verifySession(jar.get(SESSION_COOKIE)?.value);
  return loadSessionUser(payload);
});

/** The current actor, only if the account is fully active. */
export const getActor = cache(async (): Promise<Actor | null> => {
  const user = await getSessionUser();
  if (!user || !isActiveSessionUser(user)) return null;
  return user.actor;
});

/** Home of each role: owner dashboard, staff workspace, client portal. */
export function homeFor(role: string) {
  return role === "OWNER" ? "/dashboard" : role === "CLIENT" ? "/portal" : "/staff";
}

/**
 * For owner-dashboard pages (/dashboard): OWNER only. ADMIN/STAFF are sent to the
 * staff workspace, clients to their portal.
 */
export async function requireInternalPage(permission?: Permission): Promise<Actor> {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/dashboard");
  if (!isOwner(user.actor)) redirect(homeFor(user.role));
  if (!isActiveSessionUser(user)) redirect("/login");
  if (permission && !can(user.actor, permission)) redirect("/dashboard?denied=1");
  return user.actor;
}

/**
 * For team-workspace pages any employee may open (/staff overview, notifications, own profile,
 * and pages gated purely by a permission such as the marketer leads table). With `permissions`,
 * at least one of them is required. The owner works in the owner dashboard.
 */
export async function requireTeamPage(permissions?: Permission | Permission[]): Promise<Actor> {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/staff");
  if (user.role === "OWNER") redirect("/dashboard");
  if (!isTeamMember(user.actor)) redirect(homeFor(user.role));
  if (!isActiveSessionUser(user)) redirect("/login");
  const required = permissions === undefined ? [] : Array.isArray(permissions) ? permissions : [permissions];
  if (required.length && !canAny(user.actor, required)) redirect("/staff?denied=1");
  return user.actor;
}

/**
 * For client-service pages of the team workspace (/staff): ADMIN and STAFF only. A Digital
 * Marketer gets the access-denied notice on the workspace home; the owner is sent to the dashboard.
 */
export async function requireStaffPage(permission?: Permission | Permission[]): Promise<Actor> {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/staff");
  if (user.role === "OWNER") redirect("/dashboard");
  if (user.role === "DIGITAL_MARKETER") redirect("/staff?denied=1");
  if (!isInternal(user.actor)) redirect(homeFor(user.role));
  if (!isActiveSessionUser(user)) redirect("/login");
  const required = permission === undefined ? [] : Array.isArray(permission) ? permission : [permission];
  if (required.length && !canAny(user.actor, required)) redirect("/staff?denied=1");
  return user.actor;
}

/** Pages shared by the owner dashboard and the staff workspace pick their guard by base path. */
export type WorkspaceBase = "/dashboard" | "/staff";
/** With several permissions, holding any one of them is enough (the Owner holds all). */
export function requireWorkspacePage(base: WorkspaceBase, permission?: Permission | Permission[]) {
  if (base === "/staff") return requireStaffPage(permission);
  return requireInternalPage(Array.isArray(permission) ? undefined : permission);
}

/**
 * For owner-only pages: any other role (ADMIN, STAFF, CLIENT) gets a plain 404,
 * so the page's existence and contents are never disclosed.
 */
export async function requireOwnerPage(): Promise<Actor> {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/dashboard");
  if (!isActiveSessionUser(user)) redirect("/login");
  if (!isOwner(user.actor)) notFound();
  return user.actor;
}

/** For client portal pages: pending accounts go to the pending page. */
export async function requireClientPage(): Promise<Actor> {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/portal");
  if (user.role !== "CLIENT") redirect(homeFor(user.role));
  if (!isActiveSessionUser(user)) redirect("/portal/pending");
  return user.actor;
}
