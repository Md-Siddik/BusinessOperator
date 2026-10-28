import { route, searchParamsObject } from "@/lib/api/handler";
import { listMarketerLeads } from "@/features/marketer/service";

/** The shared Digital Marketer table. Requires "View Marketer Table". */
export const GET = route({ team: true, permission: "marketerLeads.view" }, async ({ req, actor }) => listMarketerLeads(actor, searchParamsObject(req)));
