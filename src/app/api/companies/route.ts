import { route, searchParamsObject } from "@/lib/api/handler";
import { listCompanies } from "@/features/companies/service";

/**
 * GET /api/companies?country=NO&range=today — country is mandatory (or ALL).
 * The date range defaults to today in the country's timezone, matched on the
 * registry's registration date. All filtering happens in the database.
 */
export const GET = route({ internal: true, permission: "companies.read" }, async ({ req, actor }) => listCompanies(actor, { range: "today", ...searchParamsObject(req) }));
