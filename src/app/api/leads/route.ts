import { route, searchParamsObject } from "@/lib/api/handler";
import { listCompanies } from "@/features/companies/service";

/** Leads = companies that have entered the pipeline (stage beyond NEW), country-scoped. */
export const GET = route({ internal: true, permission: "companies.read" }, async ({ req, actor }) => listCompanies(actor, { ...searchParamsObject(req), leadsOnly: "true" }));
