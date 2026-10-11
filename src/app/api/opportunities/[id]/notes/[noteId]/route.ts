import { route } from "@/lib/api/handler";
import { deleteOpportunityNote } from "@/features/opportunities/service";

export const DELETE = route<{ id: string; noteId: string }>({ ownerOnly: true }, async ({ actor, params }) => deleteOpportunityNote(actor, params.id, params.noteId));
