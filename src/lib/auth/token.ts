import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@/lib/permissions";

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
    if (typeof payload.sub !== "string") return null;
    return { sub: payload.sub, role: payload.role as Role, sv: Number(payload.sv ?? 0), mf: payload.mf === true, st: typeof payload.st === "number" ? payload.st : Number(payload.iat) };
  } catch {
    return null;
  }
}
