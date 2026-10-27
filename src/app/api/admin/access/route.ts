import { readJson, route } from "@/lib/api/handler";
import { ACCESS_MANAGER_PERMISSIONS, getRoleTemplates, listAccess, setRoleTemplate } from "@/features/access/service";

/** Accounts the actor may manage, with per-permission grant state and provenance. */
export const GET = route({ team: true, anyPermission: ACCESS_MANAGER_PERMISSIONS }, async ({ req, actor }) => ({
  users: await listAccess(actor, { q: req.nextUrl.searchParams.get("q") ?? undefined }),
}));

/**
 * Owner only: change a role's template (default starting access), optionally applying it to
 * every account with that role. Body: { role, permissions, applyToExisting }.
 */
export const PUT = route({ ownerOnly: true }, async ({ req, actor }) => {
  const result = await setRoleTemplate(actor, await readJson(req));
  return { ...result, templates: await getRoleTemplates() };
});
