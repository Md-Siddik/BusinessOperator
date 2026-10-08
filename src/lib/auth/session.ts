import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { can, isInternal, type Actor, type Permission } from "@/lib/permissions";
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
    maxAge: SESSION_MAX_AGE_SECONDS,
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

/** For internal pages: redirect unless an active OWNER/ADMIN/STAFF user (with optional permission). */
export async function requireInternalPage(permission?: Permission): Promise<Actor> {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/dashboard");
  if (!isInternal(user.actor)) redirect("/portal");
  if (!isActiveSessionUser(user)) redirect("/login");
  if (permission && !can(user.actor, permission)) redirect("/dashboard?denied=1");
  return user.actor;
}

/** For client portal pages: pending accounts go to the pending page. */
export async function requireClientPage(): Promise<Actor> {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/portal");
  if (user.role !== "CLIENT") redirect("/dashboard");
  if (!isActiveSessionUser(user)) redirect("/portal/pending");
  return user.actor;
}
