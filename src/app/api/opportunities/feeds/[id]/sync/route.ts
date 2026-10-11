import { route } from "@/lib/api/handler";
import { triggerFeedSync } from "@/features/opportunities/service";

/** Manual resynchronization — queued on the durable job queue and run by the worker. */
export const POST = route<{ id: string }>({ ownerOnly: true, rateLimit: { bucket: "opp-sync", limit: 30, windowMs: 60_000 } }, async ({ actor, params }) => triggerFeedSync(actor, params.id));
