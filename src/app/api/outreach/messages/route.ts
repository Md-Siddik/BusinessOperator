import { readJson, route } from "@/lib/api/handler";
import { createDraftForCompany, listOutreachMessages } from "@/features/outreach/service";

export const GET = route({ internal: true }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  return listOutreachMessages(actor, { country: sp.get("country") ?? undefined, status: sp.get("status") ?? undefined, campaignId: sp.get("campaignId") ?? undefined, page: Number(sp.get("page") ?? 1) || 1 });
});

/** Create a personalised DRAFT for one company from a template (never sent without approval). */
export const POST = route({ internal: true }, async ({ req, actor }) => createDraftForCompany(actor, await readJson(req)));
