import { readJson, route } from "@/lib/api/handler";
import { updateServicePricing } from "@/features/service-catalog/service";

/** Update the price ({ pricing: { model, amount, currency, note } }). */
export const PATCH = route<{ id: string }>({ internal: true, staff: true, permission: "services.manage" }, async ({ req, actor, params }) => updateServicePricing(actor, params.id, await readJson(req)));
