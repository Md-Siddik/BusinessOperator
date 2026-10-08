import crypto from "node:crypto";
import { absoluteUrl } from "@/config/site";

function secret() {
  return process.env.AUTH_SECRET || "development-only-insecure-secret-change-me-please";
}

function sign(payload: string) {
  return crypto.createHmac("sha256", secret()).update(`unsubscribe:${payload}`).digest("base64url").slice(0, 32);
}

/** Signed, non-guessable unsubscribe token for an email address. */
export function createUnsubscribeToken(email: string) {
  const payload = Buffer.from(email.toLowerCase()).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyUnsubscribeToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    return Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

/** Human-facing unsubscribe page (used in the email footer). */
export function unsubscribeUrl(email: string) {
  return absoluteUrl(`/unsubscribe?token=${encodeURIComponent(createUnsubscribeToken(email))}`);
}

/** RFC 8058 one-click endpoint (used in the List-Unsubscribe header; accepts POST). */
export function unsubscribeApiUrl(email: string) {
  return absoluteUrl(`/api/email/unsubscribe?token=${encodeURIComponent(createUnsubscribeToken(email))}`);
}
