import { readJson, route } from "@/lib/api/handler";
import { getCountryAdminDetails, updateCountry } from "@/features/countries/service";

type P = { code: string };

export const GET = route<P>({ internal: true, permission: "companies.read" }, async ({ params }) => getCountryAdminDetails(params.code));
export const PATCH = route<P>({ internal: true, permission: "settings.manage" }, async ({ req, actor, params }) => updateCountry(actor, params.code, await readJson(req)));
