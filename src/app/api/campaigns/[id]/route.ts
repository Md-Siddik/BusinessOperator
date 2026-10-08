import { readJson, route } from "@/lib/api/handler";
import { generateCampaignDrafts, getCampaignDetail, saveCampaign, setCampaignStatus } from "@/features/outreach/service";

type P = { id: string };
export const GET = route<P>({ internal: true }, async ({ actor, params }) => getCampaignDetail(actor, params.id));
export const PATCH = route<P>({ internal: true }, async ({ req, actor, params }) => {
  const body = (await readJson(req)) as Record<string, unknown>;
  // A status-only payload pauses/activates; anything else is a full update.
  return Object.keys(body).length === 1 && "status" in body ? setCampaignStatus(actor, params.id, body) : saveCampaign(actor, params.id, body);
});
/** Generate personalised drafts for the campaign segment (human review still required). */
export const POST = route<P>({ internal: true }, async ({ req, actor, params }) => generateCampaignDrafts(actor, params.id, await readJson(req)));
