import { route } from "@/lib/api/handler";
import { recheckOpportunity } from "@/features/opportunities/service";

/** Re-check activity at the source now. A failed check never marks the opportunity closed. */
export const POST = route<{ id: string }>({ ownerOnly: true, rateLimit: { bucket: "opp-check", limit: 60, windowMs: 60_000 } }, async ({ actor, params }) => recheckOpportunity(actor, params.id));
