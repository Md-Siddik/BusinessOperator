import { readJson, route } from "@/lib/api/handler";
import { updateServiceLanding } from "@/features/service-catalog/service";

/** Update landing-page content ({ locale: "en" | "no" | …, landing: { … } }); English is the base text. */
export const PATCH = route<{ id: string }>({ internal: true, staff: true, permission: "services.manage" }, async ({ req, actor, params }) => updateServiceLanding(actor, params.id, await readJson(req)));
