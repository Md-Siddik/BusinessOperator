import { readJson, route } from "@/lib/api/handler";
import { saveCaseStudy } from "@/features/content/service";

export const PATCH = route<{ id: string }>({ internal: true, staff: true, permission: "content.manage" }, async ({ req, actor, params }) => saveCaseStudy(actor, params.id, await readJson(req)));
