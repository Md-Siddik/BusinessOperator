import { route } from "@/lib/api/handler";
import { markConversationRead } from "@/features/chat/service";

export const POST = route<{ id: string }>({ allowPendingClient: true }, async ({ actor, params }) => {
  await markConversationRead(actor, params.id);
  return { ok: true };
});
