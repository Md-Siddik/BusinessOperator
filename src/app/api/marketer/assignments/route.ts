import { route, searchParamsObject } from "@/lib/api/handler";
import { listLeadAssignments } from "@/features/marketer/owner-table";

/** Owner: every record of the Digital Marketer table (all marketers), with change history. */
export const GET = route({ team: true, permission: "marketerTable.manage" }, async ({ req, actor }) => listLeadAssignments(actor, searchParamsObject(req)));
