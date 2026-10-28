import { readJson, route } from "@/lib/api/handler";
import { updateLeadOutreachStatus } from "@/features/marketer/service";

type P = { id: string };

/** Set the outreach status of a lead in the shared marketer table: { outreachStatus }. */
export const PATCH = route<P>({ team: true, permission: "marketerLeads.view", rateLimit: { bucket: "lead-outreach", limit: 120, windowMs: 60_000 } }, async ({ req, actor, params }) => updateLeadOutreachStatus(actor, params.id, await readJson(req)));
