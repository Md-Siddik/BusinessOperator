import { readJson, route } from "@/lib/api/handler";
import { bulkUpdateOpportunities } from "@/features/opportunities/service";

export const POST = route({ ownerOnly: true }, async ({ req, actor }) => bulkUpdateOpportunities(actor, await readJson(req)));
