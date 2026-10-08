import { readJson, route } from "@/lib/api/handler";
import { changePassword } from "@/features/auth/service";
import { revokeSessions, updateOwnProfile } from "@/features/users/service";
import { clearSessionCookie } from "@/lib/auth/session";

export const GET = route({}, async ({ actor }) => ({ id: actor.id, name: actor.name, email: actor.email, role: actor.role, permissions: actor.permissions, organizationId: actor.organizationId }));

/** Update own profile / notification preferences. */
export const PATCH = route({}, async ({ req, actor }) => {
  await updateOwnProfile(actor, await readJson(req));
  return { ok: true };
});

/** Account actions: change password or sign out of all sessions. */
export const POST = route({}, async ({ req, actor }) => {
  const body = (await readJson(req)) as { action?: string };
  if (body.action === "change-password") await changePassword(actor.id, body);
  else if (body.action === "revoke-sessions") {
    await revokeSessions(actor, actor.id);
    await clearSessionCookie();
  }
  return { ok: true };
});
