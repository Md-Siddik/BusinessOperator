import { readJson, route } from "@/lib/api/handler";
import { ACCESS_MANAGER_PERMISSIONS, changeAccess, getAccess } from "@/features/access/service";

type P = { id: string };

export const GET = route<P>({ team: true, anyPermission: ACCESS_MANAGER_PERMISSIONS }, async ({ actor, params }) => getAccess(actor, params.id));

/**
 * Grant or revoke one permission: { permission, action: "grant" | "revoke" }. Every request is
 * checked against the grant policy server-side — Owner-only entries (Company Intelligence) are
 * always refused, delegates are limited to their scoped authority. Idempotent.
 */
export const POST = route<P>({ team: true, anyPermission: ACCESS_MANAGER_PERMISSIONS }, async ({ req, actor, params }) => changeAccess(actor, params.id, await readJson(req)));
