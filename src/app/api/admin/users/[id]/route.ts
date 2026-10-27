import { readJson, route } from "@/lib/api/handler";
import { deleteUserAccount, revokeSessions, updateInternalUser } from "@/features/users/service";

type P = { id: string };
export const PATCH = route<P>({ internal: true, staff: true, permission: "users.manage" }, async ({ req, actor, params }) => {
  await updateInternalUser(actor, params.id, await readJson(req));
  return { ok: true };
});
/** Revoke all sessions of a user. */
export const POST = route<P>({ internal: true, staff: true, permission: "users.manage" }, async ({ actor, params }) => {
  await revokeSessions(actor, params.id);
  return { ok: true };
});
/** Permanently delete a team or client account (Owner only — enforced in the service). */
export const DELETE = route<P>({ internal: true, staff: true, permission: "users.manage" }, async ({ actor, params }) => {
  await deleteUserAccount(actor, params.id);
  return { ok: true };
});
