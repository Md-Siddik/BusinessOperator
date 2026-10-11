import { route, searchParamsObject } from "@/lib/api/handler";
import { listOpportunities } from "@/features/opportunities/service";

/**
 * Verified Opportunity Intelligence — OWNER ONLY. Every route under /api/opportunities uses
 * `ownerOnly` (role checked server-side; 401 unauthenticated, 403 any other role) and the
 * service layer re-checks the role before touching data.
 */
export const GET = route({ ownerOnly: true }, async ({ req, actor }) => listOpportunities(actor, searchParamsObject(req)));
