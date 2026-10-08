import { readJson, route } from "@/lib/api/handler";
import { listCampaigns, saveCampaign } from "@/features/outreach/service";

export const GET = route({ internal: true }, async ({ req, actor }) => listCampaigns(actor, { country: req.nextUrl.searchParams.get("country") ?? undefined }));
export const POST = route({ internal: true }, async ({ req, actor }) => saveCampaign(actor, null, await readJson(req)));
