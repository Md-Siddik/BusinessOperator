import { readJson, route } from "@/lib/api/handler";
import { listTemplates, saveTemplate } from "@/features/outreach/service";

export const GET = route({ internal: true }, async ({ req, actor }) => listTemplates(actor, { country: req.nextUrl.searchParams.get("country") ?? undefined }));
export const POST = route({ internal: true }, async ({ req, actor }) => saveTemplate(actor, null, await readJson(req)));
