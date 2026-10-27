import { route, searchParamsObject } from "@/lib/api/handler";
import { listDirectory } from "@/features/companies/intel";

/** Company Intelligence directory for team members granted “View Company Intelligence” (and the Owner). */
export const GET = route({ team: true, permission: "companies.read" }, async ({ req, actor }) => listDirectory(actor, searchParamsObject(req)));
