import { readJson, route } from "@/lib/api/handler";
import { updateContactRequest } from "@/features/content/service";

export const PATCH = route<{ id: string }>({ internal: true, permission: "clients.manage" }, async ({ req, actor, params }) => {
  await updateContactRequest(actor, params.id, await readJson(req));
  return { ok: true };
});
