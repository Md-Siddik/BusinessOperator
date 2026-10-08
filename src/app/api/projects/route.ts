import { readJson, route } from "@/lib/api/handler";
import { listProjects, saveProject } from "@/features/projects/service";

export const GET = route({}, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  return listProjects(actor, { status: sp.get("status") ?? undefined, organizationId: sp.get("organizationId") ?? undefined, page: Number(sp.get("page") ?? 1) || 1 });
});
export const POST = route({ internal: true }, async ({ req, actor }) => saveProject(actor, null, await readJson(req)));
