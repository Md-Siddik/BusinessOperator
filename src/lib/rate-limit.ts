import { Errors } from "@/lib/errors";

/**
 * Fixed-window in-memory rate limiter. Suitable for a single instance; for
 * horizontal scaling replace the store with Redis (same interface).
 */
type Bucket = { count: number; resetAt: number };
const g = globalThis as unknown as { __etRateLimit?: Map<string, Bucket> };
const store = (g.__etRateLimit ??= new Map());

export type RateLimitRule = { bucket: string; limit: number; windowMs: number };

export const RATE_LIMITS = {
  login: { bucket: "login", limit: 10, windowMs: 15 * 60_000 },
  signup: { bucket: "signup", limit: 5, windowMs: 60 * 60_000 },
  passwordReset: { bucket: "password-reset", limit: 5, windowMs: 60 * 60_000 },
  contact: { bucket: "contact", limit: 5, windowMs: 10 * 60_000 },
  message: { bucket: "message", limit: 60, windowMs: 60_000 },
  upload: { bucket: "upload", limit: 30, windowMs: 10 * 60_000 },
  audit: { bucket: "website-audit", limit: 30, windowMs: 60 * 60_000 },
} satisfies Record<string, RateLimitRule>;

export function checkRateLimit(rule: RateLimitRule, key: string) {
  const now = Date.now();
  const id = `${rule.bucket}:${key}`;
  const bucket = store.get(id);
  if (!bucket || bucket.resetAt <= now) {
    store.set(id, { count: 1, resetAt: now + rule.windowMs });
    if (store.size > 50_000) for (const [k, v] of store) if (v.resetAt <= now) store.delete(k);
    return true;
  }
  bucket.count += 1;
  return bucket.count <= rule.limit;
}

export function enforceRateLimit(rule: RateLimitRule, key: string) {
  if (!checkRateLimit(rule, key)) throw Errors.tooManyRequests();
}

export function resetRateLimits() {
  store.clear();
}
