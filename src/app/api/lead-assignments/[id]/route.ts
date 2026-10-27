import { route } from "@/lib/api/handler";
import { withdrawLeadAssignment } from "@/features/marketer/service";

type P = { id: string };

/** Owner only: withdraw a lead from a Digital Marketer (kept with history; can be sent again). */
export const DELETE = route<P>({ internal: true, ownerOnly: true, permission: "leads.sendToMarketer" }, async ({ actor, params }) => withdrawLeadAssignment(actor, params.id));
