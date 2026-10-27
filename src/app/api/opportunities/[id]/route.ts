import { readJson, route } from "@/lib/api/handler";
import { getOpportunityDetail, updateOpportunity } from "@/features/opportunities/service";

type P = { id: string };

// Owner, or a team member granted "View Opportunity Intelligence" (read only; Owner-private fields stripped).
export const GET = route<P>({ team: true, permission: "opportunities.view" }, async ({ actor, params }) => getOpportunityDetail(actor, params.id));
export const PATCH = route<P>({ ownerOnly: true }, async ({ req, actor, params }) => updateOpportunity(actor, params.id, await readJson(req)));
