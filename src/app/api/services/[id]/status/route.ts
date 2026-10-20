import { readJson, route } from "@/lib/api/handler";
import { setServiceStatus } from "@/features/service-catalog/service";

/** Activate / deactivate a service ({ active: boolean }). Deactivating also removes "featured". */
export const POST = route<{ id: string }>({ internal: true, staff: true, permission: "services.manage" }, async ({ req, actor, params }) => setServiceStatus(actor, params.id, await readJson(req)));
