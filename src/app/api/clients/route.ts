import { route } from "@/lib/api/handler";
import { listOrganizations } from "@/features/clients/service";

export const GET = route({ internal: true }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  return listOrganizations(actor, { q: sp.get("q") ?? undefined, status: sp.get("status") ?? undefined, page: Number(sp.get("page") ?? 1) || 1 });
});
