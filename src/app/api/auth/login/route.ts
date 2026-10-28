import { readJson, route } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { homeFor, setSessionCookie } from "@/lib/auth/session";
import { beginLogin } from "@/features/auth/verification";
import { authenticate } from "@/features/auth/service";
import { CONSENT_COOKIE, VISITOR_COOKIE } from "@/features/website-analytics/classify";
import { hasAnalyticsConsent } from "@/lib/consent";
import { linkVisitorToUser } from "@/features/website-analytics/collect";

/** After login, go to `next` only when it lies inside the user's own area. */
function safeNext(next: unknown, role: string) {
  const home = homeFor(role);
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return home;
  return next === home || next.startsWith(`${home}/`) || next.startsWith(`${home}?`) ? next : home;
}

export const POST = route({ auth: "none", rateLimit: RATE_LIMITS.login }, async ({ req, ip }) => {
  const body = (await readJson(req)) as { next?: unknown };
  const user = await authenticate(body, ip);
  const registration = await beginLogin(user);
  if (registration) return registration;
  await setSessionCookie({ sub: String(user._id), role: user.role, sv: user.sessionVersion ?? 0 });
  // Client accounts on a browser that accepted analytics: link the earlier anonymous visits.
  if (hasAnalyticsConsent(req.cookies.get(CONSENT_COOKIE)?.value)) {
    await linkVisitorToUser(req.cookies.get(VISITOR_COOKIE)?.value, { id: String(user._id), role: user.role }).catch((err) => console.error("[login] analytics link failed", err));
  }
  return { redirect: safeNext(body.next, user.role) };
});
