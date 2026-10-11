import { readJson, route } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { homeFor, setSessionCookie } from "@/lib/auth/session";
import { authenticate } from "@/features/auth/service";

/** After login, go to `next` only when it lies inside the user's own area. */
function safeNext(next: unknown, role: string) {
  const home = homeFor(role);
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return home;
  return next === home || next.startsWith(`${home}/`) || next.startsWith(`${home}?`) ? next : home;
}

export const POST = route({ auth: "none", rateLimit: RATE_LIMITS.login }, async ({ req, ip }) => {
  const body = (await readJson(req)) as { next?: unknown };
  const user = await authenticate(body, ip);
  await setSessionCookie({ sub: String(user._id), role: user.role, sv: user.sessionVersion ?? 0 });
  return { redirect: safeNext(body.next, user.role) };
});
