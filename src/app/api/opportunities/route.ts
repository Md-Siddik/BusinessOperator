import { route, searchParamsObject } from "@/lib/api/handler";
import { listOpportunities } from "@/features/opportunities/service";

/**
 * Verified Opportunity Intelligence — OWNER ONLY. Every route under /api/opportunities uses
 * `ownerOnly` (role checked server-side; 401 unauthenticated, 403 any other role) and the
 * service layer re-checks the role before touching data.
 */
// Owner, or a team member granted "View Opportunity Intelligence" (read only; Owner-private fields stripped).
export const GET = route({ team: true, permission: "opportunities.view" }, async ({ req, actor }) => listOpportunities(actor, searchParamsObject(req)));
