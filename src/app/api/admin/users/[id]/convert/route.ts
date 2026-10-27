import { readJson, route } from "@/lib/api/handler";
import { convertClientToTeamMember } from "@/features/users/service";

type P = { id: string };
/** Turn a client account into a team account with a role (Owner only — enforced in the service). */
export const POST = route<P>({ internal: true, staff: true, permission: "users.manage" }, async ({ req, actor, params }) => convertClientToTeamMember(actor, params.id, await readJson(req)));
