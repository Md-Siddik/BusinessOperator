import { readJson, route } from "@/lib/api/handler";
import { getOutreachMessage, updateDraft } from "@/features/outreach/service";

type P = { id: string };
export const GET = route<P>({ internal: true }, async ({ actor, params }) => getOutreachMessage(actor, params.id));
export const PATCH = route<P>({ internal: true }, async ({ req, actor, params }) => {
  await updateDraft(actor, params.id, await readJson(req));
  return { ok: true };
});
