import { route } from "@/lib/api/handler";
import { getOpportunityStats } from "@/features/opportunities/service";

export const GET = route({ ownerOnly: true }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type");
  return getOpportunityStats(actor, { periodDays: Number(sp.get("days")) || 7, country: sp.get("country") ?? undefined, type: type === "HIRING" || type === "PROCUREMENT" ? type : undefined });
});
