import { readJson, route } from "@/lib/api/handler";
import { ACCESS_MANAGER_PERMISSIONS, applyAccessChanges, applyPreset, changeAccess, getAccess } from "@/features/access/service";

type P = { id: string };

export const GET = route<P>({ team: true, anyPermission: ACCESS_MANAGER_PERMISSIONS }, async ({ actor, params }) => getAccess(actor, params.id));

/**
 * Change one person's access. Bodies:
 *  - { permission, action: "grant" | "revoke" } — one permission (returns the person's view)
 *  - { changes: [{ permission, action }, …] }   — several at once, e.g. a service toggle
 *  - { preset: "<preset id>" | "role-template" } — set access to a template
 * Every change is checked against the grant policy server-side and audited individually —
 * Owner-only entries are always refused, delegates are limited to their scoped authority.
 */
export const POST = route<P>({ team: true, anyPermission: ACCESS_MANAGER_PERMISSIONS }, async ({ req, actor, params }) => {
  const body = (await readJson(req)) as Record<string, unknown>;
  if (Array.isArray(body?.changes)) return applyAccessChanges(actor, params.id, body);
  if (typeof body?.preset === "string") return applyPreset(actor, params.id, body);
  return changeAccess(actor, params.id, body);
});
