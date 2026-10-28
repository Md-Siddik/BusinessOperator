import { readJson, route } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { signupClient } from "@/features/auth/service";
import { hasAnalyticsConsent } from "@/lib/consent";
import { CONSENT_COOKIE, VISITOR_COOKIE } from "@/features/website-analytics/classify";
import { recordConversion } from "@/features/website-analytics/collect";

export const POST = route({ auth: "none", rateLimit: RATE_LIMITS.signup }, async ({ req, ip }) => {
  // A client sign-up is a voluntary lead; attributed only for a browser that accepted analytics.
  const vid = hasAnalyticsConsent(req.cookies.get(CONSENT_COOKIE)?.value) ? req.cookies.get(VISITOR_COOKIE)?.value : undefined;
  return signupClient(await readJson(req), ip, { onCreated: (userId) => recordConversion({ type: "client_signup", key: `signup:${userId}`, vid, userId }) });
});
