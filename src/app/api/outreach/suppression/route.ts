import { readJson, route } from "@/lib/api/handler";
import { addSuppression, listSuppressions } from "@/features/outreach/suppression";

export const GET = route({ internal: true }, async ({ req, actor }) => listSuppressions(actor, { q: req.nextUrl.searchParams.get("q") ?? undefined, page: Number(req.nextUrl.searchParams.get("page") ?? 1) || 1 }));
export const POST = route({ internal: true }, async ({ req, actor }) => {
  await addSuppression(actor, await readJson(req));
  return { ok: true };
});
