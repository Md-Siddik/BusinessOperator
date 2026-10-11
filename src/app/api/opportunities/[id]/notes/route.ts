import { readJson, route } from "@/lib/api/handler";
import { addOpportunityNote } from "@/features/opportunities/service";

export const POST = route<{ id: string }>({ ownerOnly: true }, async ({ req, actor, params }) => addOpportunityNote(actor, params.id, await readJson(req)));
