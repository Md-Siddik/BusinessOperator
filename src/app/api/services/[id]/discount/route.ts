import { readJson, route } from "@/lib/api/handler";
import { updateServiceDiscount } from "@/features/service-catalog/service";

/** Set the discount ({ discount: { enabled, type, value, label, startsAt, endsAt } }) or remove it ({ discount: null }). */
export const PATCH = route<{ id: string }>({ internal: true, staff: true, permission: "services.manage" }, async ({ req, actor, params }) => updateServiceDiscount(actor, params.id, await readJson(req)));
