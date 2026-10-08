import { readJson, route } from "@/lib/api/handler";
import { getConversation, updateConversation } from "@/features/chat/service";

type P = { id: string };
export const GET = route<P>({}, async ({ req, actor, params }) => getConversation(actor, params.id, { before: req.nextUrl.searchParams.get("before") ?? undefined }));
export const PATCH = route<P>({}, async ({ req, actor, params }) => {
  await updateConversation(actor, params.id, await readJson(req));
  return { ok: true };
});
