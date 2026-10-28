import { route, searchParamsObject } from "@/lib/api/handler";
import { listOldCompanies } from "@/features/established/service";

/** Old company Intelligence list — its own dataset only (never startup records, no fallback). */
export const GET = route({ internal: true, permission: "companies.read" }, async ({ req, actor }) => listOldCompanies(actor, searchParamsObject(req)));
