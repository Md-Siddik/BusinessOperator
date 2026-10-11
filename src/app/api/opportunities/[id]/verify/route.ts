import { readJson, route } from "@/lib/api/handler";
import { verifyOpportunityManually } from "@/features/opportunities/service";

export const POST = route<{ id: string }>({ ownerOnly: true }, async ({ req, actor, params }) => verifyOpportunityManually(actor, params.id, await readJson(req)));
