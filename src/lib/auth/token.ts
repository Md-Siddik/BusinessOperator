import { SignJWT, jwtVerify } from "jose";
import { ROLES, type Role } from "@/lib/permissions/catalog";

/**
 * Session tokens: HS256 JWTs in an httpOnly cookie. No Node-only imports, so
 * the proxy (src/proxy.ts) can verify tokens for coarse route gating; full
 * authorization re-checks the user in the database on every request.
 */
export const SESSION_COOKIE = "et_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export type SessionPayload = { sub: string; role: Role; sv: number; mf?: boolean; st?: number };

let warned = false;
function getSecret() {
  let secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
      throw new Error("AUTH_SECRET must be set (32+ characters) in production");
    }
    if (!warned) {
      console.warn("[auth] AUTH_SECRET is not set — using an insecure development secret.");
      warned = true;
    }
    secret = "development-only-insecure-secret-change-me-please";
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload) {
  const now = Math.floor(Date.now() / 1000);
  const started = payload.st ?? now;
  return new SignJWT({ role: payload.role, sv: payload.sv, mf: payload.mf === true, st: started })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(Math.min(now + SESSION_MAX_AGE_SECONDS, started + 30 * 86400))
    .sign(getSecret());
}

export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ["HS256"] });
    // Typed tokens (e.g. the role-preview token) are never sessions.
    if (typeof payload.sub !== "string" || payload.typ !== undefined) return null;
    return { sub: payload.sub, role: payload.role as Role, sv: Number(payload.sv ?? 0), mf: payload.mf === true, st: typeof payload.st === "number" ? payload.st : Number(payload.iat) };
  } catch {
    return null;
  }
}

/**
 * "View as Role" (Owner only): a separate signed cookie naming the role being previewed. It is
 * bound to the Owner's account and session version, never replaces the session cookie, and only
 * changes the effective role of requests made with that same session (see lib/auth/preview).
 */
export const PREVIEW_COOKIE = "et_role_preview";
export const PREVIEW_MAX_AGE_SECONDS = 60 * 60 * 8;
const PREVIEW_TYPE = "role-preview";

export type PreviewPayload = { sub: string; sv: number; role: Role };

/** Roles the Owner can preview: every role in the catalog except the Owner's own. */
export function isPreviewableRole(role: unknown): role is Role {
  return typeof role === "string" && role !== "OWNER" && (ROLES as readonly string[]).includes(role);
}

export async function signPreview(payload: PreviewPayload) {
  return new SignJWT({ typ: PREVIEW_TYPE, role: payload.role, sv: payload.sv })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + PREVIEW_MAX_AGE_SECONDS)
    .sign(getSecret());
}

/** A valid preview token, or null (bad signature, expired, wrong type, or a role that no longer exists). */
export async function verifyPreview(token: string | undefined | null): Promise<PreviewPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ["HS256"] });
    if (payload.typ !== PREVIEW_TYPE || typeof payload.sub !== "string" || !isPreviewableRole(payload.role)) return null;
    return { sub: payload.sub, sv: Number(payload.sv ?? 0), role: payload.role };
  } catch {
    return null;
  }
}
