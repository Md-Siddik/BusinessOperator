import { route, searchParamsObject } from "@/lib/api/handler";
import { Errors } from "@/lib/errors";
import { analyticsRange, getCampaigns, getLocations, getOverview, getPages, getRecentVisits, getServicePerformance, getSources, listVisitors } from "@/features/website-analytics/service";

/** Website analytics statistics (OWNER ONLY; the service checks the role again). */
export const GET = route({ ownerOnly: true }, async ({ req, actor }) => {
  const params = searchParamsObject(req);
  const r = analyticsRange(params);
  const range = { preset: r.preset, from: r.from, to: r.to, label: r.label };
  switch (params.view ?? "overview") {
    case "overview":
      return { range, overview: await getOverview(actor, r) };
    case "sources":
      return { range, sources: await getSources(actor, r) };
    case "campaigns":
      return { range, campaigns: await getCampaigns(actor, r) };
    case "locations":
      return { range, locations: await getLocations(actor, r) };
    case "recent":
      return { range, visits: await getRecentVisits(actor, r, 50) };
    case "pages":
      return { range, pages: await getPages(actor, r) };
    case "services":
      return { range, services: await getServicePerformance(actor, r) };
    case "visitors":
      return { range, visitors: await listVisitors(actor, r, { page: Number(params.page) || 1 }) };
    default:
      throw Errors.badRequest("Unknown view");
  }
});
