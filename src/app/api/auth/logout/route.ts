import { route } from "@/lib/api/handler";
import { clearSessionCookie } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

export const POST = route({ auth: "optional" }, async ({ actor }) => {
  if (actor) await audit(actor, "auth.logout", { entityType: "User", entityId: actor.id });
  await clearSessionCookie();
  return { ok: true };
});
