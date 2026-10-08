import { readJson, route } from "@/lib/api/handler";
import { listCaseStudiesAdmin, saveCaseStudy } from "@/features/content/service";

export const GET = route({ internal: true, permission: "content.manage" }, async ({ actor }) => listCaseStudiesAdmin(actor));
export const POST = route({ internal: true, permission: "content.manage" }, async ({ req, actor }) => saveCaseStudy(actor, null, await readJson(req)));
