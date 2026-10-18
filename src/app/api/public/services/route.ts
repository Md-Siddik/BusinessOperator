import { isLanguageCode } from "@/config/languages";
import { route, searchParamsObject } from "@/lib/api/handler";
import { listPublicServices } from "@/features/service-catalog/service";

/** Public: active services in one language (public fields only; no drafts, no trash, no internal ids). */
export const GET = route({ auth: "none", rateLimit: { bucket: "public-services", limit: 120, windowMs: 60_000 } }, async ({ req }) => {
  const locale = searchParamsObject(req).locale ?? "en";
  return listPublicServices(isLanguageCode(locale) ? locale : "en");
});
