import { readJson, route } from "@/lib/api/handler";
import { getCompanyTemplate } from "@/features/email-sender/service";

/**
 * Email Sender (OWNER ONLY): the suggested, personalised template for one company, plus
 * whether its single reminder may be sent. `ownerOnly` rejects other roles (401/403);
 * the service re-checks the role and loads the company data itself.
 */
export const POST = route({ ownerOnly: true }, async ({ req, actor }) => getCompanyTemplate(actor, await readJson(req)));
