import { readJson, route } from "@/lib/api/handler";
import { getOpportunityDetail, updateOpportunity } from "@/features/opportunities/service";

type P = { id: string };

export const GET = route<P>({ ownerOnly: true }, async ({ actor, params }) => getOpportunityDetail(actor, params.id));
export const PATCH = route<P>({ ownerOnly: true }, async ({ req, actor, params }) => updateOpportunity(actor, params.id, await readJson(req)));
