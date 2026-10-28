import { readJson, route } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { submitContactRequest } from "@/features/content/service";
import { CONSENT_COOKIE, VISITOR_COOKIE } from "@/features/website-analytics/classify";
import { hasAnalyticsConsent } from "@/lib/consent";
import { enquiryConversionType, linkVisitorToEnquiry, recordConversion } from "@/features/website-analytics/collect";

export const POST = route({ auth: "optional", rateLimit: RATE_LIMITS.contact }, async ({ req, actor }) => {
  // Browsers that accepted analytics: the enquiry is linked to their earlier visits.
  const vid = hasAnalyticsConsent(req.cookies.get(CONSENT_COOKIE)?.value) ? req.cookies.get(VISITOR_COOKIE)?.value : undefined;
  return submitContactRequest(await readJson(req), {
    actor,
    onCreated: async (id, enquiry) => {
      if (vid) await linkVisitorToEnquiry(vid, id);
      // Every enquiry counts as a lead; attribution only for a browser that accepted analytics.
      if (!enquiry.isDemo) await recordConversion({ type: enquiryConversionType(enquiry.preferredContact), key: `contact:${id}`, vid, contactRequestId: id, serviceSlug: enquiry.serviceSlug });
    },
  });
});
