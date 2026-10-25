import { route } from "@/lib/api/handler";
import { setSessionCookie } from "@/lib/auth/session";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/token";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { Errors } from "@/lib/errors";
export const POST = route({ allowPendingClient: true, rateLimit: RATE_LIMITS.message }, async ({ req, actor }) => {
  // The route guard rechecks the live database, account status, revocation version, and MFA proof.
  const payload = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!payload || !payload.st || payload.st + 30 * 86400 <= Math.floor(Date.now() / 1000)) throw Errors.unauthorized();
  await setSessionCookie({ ...payload, role: actor.role });
  return { ok: true };
});
