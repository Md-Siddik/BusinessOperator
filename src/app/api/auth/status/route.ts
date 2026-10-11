import { route } from "@/lib/api/handler";
import { homeFor } from "@/lib/auth/session";

/**
 * Header auth button: is the visitor signed in, and where is their own area?
 * (owner → /dashboard, admin/staff → /staff, client → /portal). Includes clients
 * awaiting approval. Returns only the caller's own role — no other user data.
 */
export const GET = route({ auth: "optional", allowPendingClient: true }, async ({ actor }) => {
  if (!actor) return { signedIn: false as const };
  return { signedIn: true as const, role: actor.role, home: homeFor(actor.role) };
});
