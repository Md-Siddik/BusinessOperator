import { readJson, route } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { setSessionCookie } from "@/lib/auth/session";
import { authenticate } from "@/features/auth/service";

function safeNext(next: unknown, role: string) {
  const fallback = role === "CLIENT" ? "/portal" : "/dashboard";
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return fallback;
  if (role === "CLIENT" ? !next.startsWith("/portal") : !next.startsWith("/dashboard")) return fallback;
  return next;
}

export const POST = route({ auth: "none", rateLimit: RATE_LIMITS.login }, async ({ req, ip }) => {
  const body = (await readJson(req)) as { next?: unknown };
  const user = await authenticate(body, ip);
  await setSessionCookie({ sub: String(user._id), role: user.role, sv: user.sessionVersion ?? 0 });
  return { redirect: safeNext(body.next, user.role) };
});
