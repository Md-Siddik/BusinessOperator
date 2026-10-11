import { route } from "@/lib/api/handler";
import { getSessionUser } from "@/lib/auth/session";
import { getAvailability } from "@/features/chat/service";

/**
 * Who is using the floating chat widget. Messaging requires an account:
 *  - anonymous → the widget asks the visitor to sign up or log in
 *  - client (active, or signed up and awaiting approval) → can chat
 *  - team member (owner / admin / staff) → reads and answers client conversations in place
 * Returns only the caller's own name/role — nothing about other users.
 */
export const GET = route({ auth: "optional", allowPendingClient: true }, async ({ actor }) => {
  const availability = await getAvailability();
  const base = { availability: { text: availability.text, withinHours: availability.withinHours } };
  if (!actor) return { state: "anonymous" as const, ...base };
  if (actor.role === "CLIENT") {
    const user = await getSessionUser();
    return { state: "client" as const, id: actor.id, name: actor.name, pending: user?.status === "PENDING_APPROVAL", ...base };
  }
  return { state: "team" as const, id: actor.id, name: actor.name, inboxHref: actor.role === "OWNER" ? "/dashboard/messages" : "/staff/messages", ...base };
});
