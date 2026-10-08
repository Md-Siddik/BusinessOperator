import { route } from "@/lib/api/handler";
import { removeSuppression } from "@/features/outreach/suppression";

export const DELETE = route<{ id: string }>({ internal: true }, async ({ actor, params }) => {
  await removeSuppression(actor, params.id);
  return { ok: true };
});
