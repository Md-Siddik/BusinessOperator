import { route, searchParamsObject } from "@/lib/api/handler";
import { listMarketerLeads } from "@/features/marketer/service";

/** The signed-in Digital Marketer's assigned leads. Requires "View Assigned Client Leads". */
export const GET = route({ team: true, permission: "marketerLeads.view" }, async ({ req, actor }) => listMarketerLeads(actor, searchParamsObject(req)));
