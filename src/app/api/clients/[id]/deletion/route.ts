import { z } from "zod";
import { readJson, route } from "@/lib/api/handler";
import { advanceClientDeletion, beginClientDeletion } from "@/features/clients/deletion";

export const POST = route<{ id: string }>({ internal: true, staff: true, permission: "clients.manage" }, async ({ req, actor, params }) => {
  const body = await readJson(req);
  if (body && typeof body === "object" && "action" in body && body.action === "start") {
    z.object({ action: z.literal("start") }).strict().parse(body);
    return beginClientDeletion(actor, params.id);
  }
  return advanceClientDeletion(actor, params.id, body);
});
