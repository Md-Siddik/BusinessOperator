import { route } from "@/lib/api/handler";
import { getRegistrationOverview, listCountryCards } from "@/features/companies/registrations";

/** GET /api/registrations?country=NO&range=today — header counts (today first) and timeline; ?view=countries for all country cards. */
export const GET = route({ internal: true, permission: "companies.read" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  if (sp.get("view") === "countries") return listCountryCards(actor);
  return getRegistrationOverview(actor, sp.get("country") ?? "", sp.get("range") ?? "today", sp.get("from") ?? undefined, sp.get("to") ?? undefined);
});
