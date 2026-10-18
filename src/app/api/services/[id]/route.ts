import { readJson, route, searchParamsObject } from "@/lib/api/handler";
import { deleteServicePermanently, getServiceAdmin, trashService, updateService } from "@/features/service-catalog/service";

const guard = { internal: true, staff: true, permission: "services.manage" } as const;

export const GET = route<{ id: string }>(guard, async ({ actor, params }) => getServiceAdmin(actor, params.id));
export const PATCH = route<{ id: string }>(guard, async ({ req, actor, params }) => updateService(actor, params.id, await readJson(req)));

/**
 * DELETE → move to the trash (hidden, restorable).
 * DELETE ?permanent=1 with { confirmSlug } → permanent deletion: OWNER only (checked in the service).
 */
export const DELETE = route<{ id: string }>(guard, async ({ req, actor, params }) =>
  searchParamsObject(req).permanent === "1" ? deleteServicePermanently(actor, params.id, await readJson(req)) : trashService(actor, params.id),
);
