import { readJson, route } from "@/lib/api/handler";
import { reviewContact } from "@/features/leads/workflow";

type P = { id: string };

/** Approve / reject an ambiguous contact from the review queue. */
export const POST = route<P>({ internal: true }, async ({ req, actor, params }) => reviewContact(actor, params.id, await readJson(req)));
