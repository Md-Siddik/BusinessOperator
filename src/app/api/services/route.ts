import { readJson, route, searchParamsObject } from "@/lib/api/handler";
import { createService, listServicesAdmin } from "@/features/service-catalog/service";

/**
 * Service Management (Owner, and Admin/Staff with `services.manage`).
 * `internal + staff + permission` admits the Owner and staff-workspace users holding the
 * permission; the service layer re-checks it.
 */
const guard = { internal: true, staff: true, permission: "services.manage" } as const;

export const GET = route(guard, async ({ req, actor }) => listServicesAdmin(actor, { trash: searchParamsObject(req).trash === "1" }));
export const POST = route(guard, async ({ req, actor }) => createService(actor, await readJson(req)));
