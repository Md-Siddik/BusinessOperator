import { readJson, route } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { submitContactRequest } from "@/features/content/service";
import { CONSENT_COOKIE, VISITOR_COOKIE } from "@/features/website-analytics/classify";
import { linkVisitorToEnquiry } from "@/features/website-analytics/collect";

export const POST = route({ auth: "none", rateLimit: RATE_LIMITS.contact }, async ({ req }) => {
  // Browsers that accepted analytics: the enquiry is linked to their earlier visits.
  const vid = req.cookies.get(CONSENT_COOKIE)?.value === "granted" ? req.cookies.get(VISITOR_COOKIE)?.value : undefined;
  return submitContactRequest(await readJson(req), { onCreated: vid ? (id) => linkVisitorToEnquiry(vid, id) : undefined });
});
