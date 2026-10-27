import { readJson, route } from "@/lib/api/handler";
import { Errors } from "@/lib/errors";
import { setCompanyType } from "@/features/companies/classification";
import { requestContactRefresh } from "@/features/companies/intel";

type P = { id: string; action: string };

/**
 * Record actions (companies.edit):
 *  - type:    { value: "STARTUP" | "ESTABLISHED" | "NEEDS_REVIEW" | "AUTO" } — manual Company Type
 *  - refresh: queue a fresh public-contact research run
 */
export const POST = route<P>({ team: true, permission: "companies.edit", rateLimit: { bucket: "company-intel-action", limit: 60, windowMs: 60_000 } }, async ({ req, actor, params }) => {
  switch (params.action) {
    case "type":
      return setCompanyType(actor, params.id, await readJson(req));
    case "refresh":
      return requestContactRefresh(actor, params.id);
    default:
      throw Errors.notFound();
  }
});
