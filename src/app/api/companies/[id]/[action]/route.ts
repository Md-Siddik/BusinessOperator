import { readJson, route } from "@/lib/api/handler";
import { Errors } from "@/lib/errors";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { runWebsiteAudit } from "@/features/intelligence/website-audit";
import { runEnrichment } from "@/features/intelligence/enrichment";
import { setProspectPage } from "@/features/intelligence/prospect";
import { getCompanySourceData, qualifyCompany } from "@/features/companies/service";
import { refreshCompanyFromRegistry } from "@/features/registry/refresh";
import { logContactAttempt, setEligibility } from "@/features/leads/workflow";
import { decideSuggestion } from "@/features/service-fit/service";
import { createQuotation } from "@/features/quotations/service";

type P = { id: string; action: string };

/** Company intelligence actions: qualify, refresh from registry, website audit, contact lookup, prospect page toggle. */
export const POST = route<P>({ internal: true }, async ({ req, actor, params }) => {
  switch (params.action) {
    case "audit":
      if (!checkRateLimit(RATE_LIMITS.audit, actor.id)) throw Errors.tooManyRequests();
      return runWebsiteAudit(actor, params.id);
    case "enrich":
      if (!checkRateLimit(RATE_LIMITS.audit, actor.id)) throw Errors.tooManyRequests();
      return runEnrichment(actor, params.id);
    case "eligibility":
      return setEligibility(actor, params.id, await readJson(req));
    case "contact-log":
      return logContactAttempt(actor, params.id, await readJson(req));
    case "service-fit":
      return decideSuggestion(actor, params.id, await readJson(req));
    case "quotation":
      return createQuotation(actor, params.id, await readJson(req));
    case "qualify":
      return qualifyCompany(actor, params.id, await readJson(req));
    case "refresh":
      if (!checkRateLimit(RATE_LIMITS.audit, actor.id)) throw Errors.tooManyRequests();
      return refreshCompanyFromRegistry(actor, params.id);
    case "prospect-page": {
      const { enabled } = (await readJson(req)) as { enabled?: boolean };
      return setProspectPage(actor, params.id, enabled !== false);
    }
    default:
      throw Errors.notFound();
  }
});

/** Raw provider record (administrators only — for debugging normalization). */
export const GET = route<P>({ internal: true, permission: "settings.manage" }, async ({ actor, params }) => {
  if (params.action !== "source") throw Errors.notFound();
  return getCompanySourceData(actor, params.id);
});
