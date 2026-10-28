import { route } from "@/lib/api/handler";
import { getSessionUser, setSessionCookie } from "@/lib/auth/session";
import { realRoleOf } from "@/lib/auth/preview";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/token";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { Errors } from "@/lib/errors";
export const POST = route({ allowPendingClient: true, allowInPreview: true, rateLimit: RATE_LIMITS.message }, async ({ req, actor }) => {
  // The route guard rechecks the live database, verification, status and revocation version.
  const payload = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!payload || !payload.st || payload.st + 30 * 86400 <= Math.floor(Date.now() / 1000)) throw Errors.unauthorized();
  // The real role, never a previewed one ("View as Role" leaves the session untouched).
  await setSessionCookie({ ...payload, role: realRoleOf(await getSessionUser()) ?? actor.role });
  return { ok: true };
});
