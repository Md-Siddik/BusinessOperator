import { route } from "@/lib/api/handler";
import { addOpportunityToCrm } from "@/features/opportunities/service";

export const POST = route<{ id: string }>({ ownerOnly: true }, async ({ actor, params }) => addOpportunityToCrm(actor, params.id));
