import { route } from "@/lib/api/handler";
import { reverifyFeed } from "@/features/opportunities/service";

/** Re-check that an employer's ATS board is linked from its official website. */
export const POST = route<{ id: string }>({ ownerOnly: true, rateLimit: { bucket: "opp-verify", limit: 30, windowMs: 60_000 } }, async ({ actor, params }) => reverifyFeed(actor, params.id));
