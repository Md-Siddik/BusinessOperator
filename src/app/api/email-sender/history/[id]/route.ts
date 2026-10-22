import { route } from "@/lib/api/handler";
import { deleteSentEmail } from "@/features/email-sender/service";

type P = { id: string };

/** Remove one record from the Email Sender history (OWNER ONLY). */
export const DELETE = route<P>({ ownerOnly: true }, async ({ actor, params }) => deleteSentEmail(actor, params.id));
