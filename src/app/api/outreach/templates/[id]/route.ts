import { readJson, route } from "@/lib/api/handler";
import { deleteTemplate, getTemplate, saveTemplate } from "@/features/outreach/service";

type P = { id: string };
export const GET = route<P>({ internal: true }, async ({ actor, params }) => getTemplate(actor, params.id));
export const PATCH = route<P>({ internal: true }, async ({ req, actor, params }) => saveTemplate(actor, params.id, await readJson(req)));
export const DELETE = route<P>({ internal: true }, async ({ actor, params }) => {
  await deleteTemplate(actor, params.id);
  return { ok: true };
});
