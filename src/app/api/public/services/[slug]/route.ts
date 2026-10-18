import { isLanguageCode } from "@/config/languages";
import { route, searchParamsObject } from "@/lib/api/handler";
import { Errors } from "@/lib/errors";
import { getPublicService } from "@/features/service-catalog/service";

/** Public: one active service by slug (404 for drafts, trashed or unknown services). */
export const GET = route<{ slug: string }>({ auth: "none", rateLimit: { bucket: "public-services", limit: 120, windowMs: 60_000 } }, async ({ req, params }) => {
  const locale = searchParamsObject(req).locale ?? "en";
  const service = await getPublicService(String(params.slug).toLowerCase(), isLanguageCode(locale) ? locale : "en");
  if (!service) throw Errors.notFound();
  return service;
});
