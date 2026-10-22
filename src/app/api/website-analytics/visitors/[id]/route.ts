import { route } from "@/lib/api/handler";
import { getVisitor } from "@/features/website-analytics/service";

/** One visitor's timeline (OWNER ONLY). */
export const GET = route<{ id: string }>({ ownerOnly: true }, async ({ actor, params }) => getVisitor(actor, params.id));
