import { route } from "@/lib/api/handler";
import { restoreService } from "@/features/service-catalog/service";

/** Restore a service from the trash (it stays inactive until published again). */
export const POST = route<{ id: string }>({ internal: true, staff: true, permission: "services.manage" }, async ({ actor, params }) => restoreService(actor, params.id));
