import { route } from "@/lib/api/handler";
import { clearSessionCookie } from "@/lib/auth/session";
import { User } from "@/models";
import { audit } from "@/lib/audit";

export const POST = route({ auth: "optional", allowInPreview: true }, async ({ actor }) => {
  if (actor) await User.updateOne({ _id: actor.id }, { $inc: { sessionVersion: 1 } });
  if (actor) await audit(actor, "auth.logout", { entityType: "User", entityId: actor.id });
  await clearSessionCookie();
  return { ok: true };
});
