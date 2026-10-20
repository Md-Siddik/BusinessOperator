import { readJson, route } from "@/lib/api/handler";
import { reorderServices } from "@/features/service-catalog/service";

/** New display order ({ ids: [...] } in the arranged order). */
export const POST = route({ internal: true, staff: true, permission: "services.manage" }, async ({ req, actor }) => reorderServices(actor, await readJson(req)));
