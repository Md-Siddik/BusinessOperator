import { readJson, route } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { consumeAuthCode } from "@/features/auth/verification";
import { safeAuthNext } from "@/lib/auth/redirect";
import { setSessionCookie } from "@/lib/auth/session";
export const POST = route({ auth: "none", rateLimit: RATE_LIMITS.login }, async ({ req }) => {
  const body = await readJson(req) as { next?: unknown; challenge?: unknown };
  const user = await consumeAuthCode(body);
  await setSessionCookie({ sub: String(user._id), role: user.role, sv: user.sessionVersion ?? 0, mf: typeof body.challenge === "string" });
  return { redirect: safeAuthNext(body.next, user.role) };
});
