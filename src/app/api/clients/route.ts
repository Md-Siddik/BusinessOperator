import { readJson, route } from "@/lib/api/handler";
import { createOrganization, listOrganizations } from "@/features/clients/service";

export const POST = route({ internal: true, staff: true, permission: "clients.manage" }, async ({ req, actor }) => createOrganization(actor, await readJson(req)));

export const GET = route({ internal: true, staff: true }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  return listOrganizations(actor, { q: sp.get("q") ?? undefined, status: sp.get("status") ?? undefined, page: Number(sp.get("page") ?? 1) || 1 });
});
