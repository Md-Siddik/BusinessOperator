import { readJson, route } from "@/lib/api/handler";
import { revokeSessions, updateInternalUser } from "@/features/users/service";

type P = { id: string };
export const PATCH = route<P>({ internal: true }, async ({ req, actor, params }) => {
  await updateInternalUser(actor, params.id, await readJson(req));
  return { ok: true };
});
/** Revoke all sessions of a user. */
export const POST = route<P>({ internal: true }, async ({ actor, params }) => {
  await revokeSessions(actor, params.id);
  return { ok: true };
});
