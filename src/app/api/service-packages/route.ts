import { readJson, route } from "@/lib/api/handler";
import { listPackages, savePackage } from "@/features/service-fit/service";

export const GET = route({ internal: true, permission: "companies.read" }, async () => listPackages());
export const POST = route({ internal: true, permission: "settings.manage" }, async ({ req, actor }) => savePackage(actor, null, await readJson(req)));
