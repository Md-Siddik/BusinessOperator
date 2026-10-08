import { readJson, route } from "@/lib/api/handler";
import { updateFollowUp } from "@/features/crm/service";

export const PATCH = route<{ id: string }>({ internal: true }, async ({ req, actor, params }) => {
  await updateFollowUp(actor, params.id, await readJson(req));
  return { ok: true };
});
