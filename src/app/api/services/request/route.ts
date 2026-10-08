import { readJson, route } from "@/lib/api/handler";
import { requestClientService } from "@/features/clients/service";

/** Client requests an additional service for their organization. */
export const POST = route({ clientOnly: true }, async ({ req, actor }) => {
  await requestClientService(actor, await readJson(req));
  return { ok: true };
});
