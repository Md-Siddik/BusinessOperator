import { z } from "zod";
import { readJson, route } from "@/lib/api/handler";
import { audit } from "@/lib/audit";
import { clearPreviewCookie, getSessionPayload, getSessionUser, setPreviewCookie } from "@/lib/auth/session";
import { listPreviewRoles, realRoleOf, workspaceFor } from "@/lib/auth/preview";
import { isPreviewableRole } from "@/lib/auth/token";
import { Errors } from "@/lib/errors";
import type { Role } from "@/lib/permissions";

/**
 * "View as Role" (Owner only — checked on the account's real role, so it works while a preview is
 * active and never for anyone else). Roles come from the role catalog and the stored role templates.
 *  GET    → the roles that can be previewed, with their current permissions, and the active preview
 *  POST   → { role } start (or switch) a preview; the session itself is not changed
 *  DELETE → end the preview
 */
async function requireRealOwner() {
  const user = await getSessionUser();
  const session = await getSessionPayload();
  if (!user || !session || realRoleOf(user) !== "OWNER") throw Errors.forbidden();
  return { user, session, owner: { id: user.id, email: user.email, role: "OWNER" as Role } };
}

export const GET = route({ allowInPreview: true }, async () => {
  const { user } = await requireRealOwner();
  return { active: user.preview ?? null, roles: await listPreviewRoles() };
});

const startSchema = z.object({ role: z.string().refine(isPreviewableRole, "Choose an existing role.") });

export const POST = route({ allowInPreview: true }, async ({ req }) => {
  const { user, session, owner } = await requireRealOwner();
  const { role } = startSchema.parse(await readJson(req)) as { role: Role };
  await setPreviewCookie({ sub: user.id, sv: session.sv, role });
  await audit(owner, "role_preview.started", { entityType: "Role", entityId: role, metadata: { from: user.preview?.role ?? null } });
  return { ok: true, role, home: workspaceFor(role) };
});

/** Ending a preview only removes the preview cookie, so any signed-in account may call it. */
export const DELETE = route({ auth: "optional", allowInPreview: true }, async () => {
  const user = await getSessionUser();
  await clearPreviewCookie();
  if (user?.preview) await audit({ id: user.id, email: user.email, role: user.preview.realRole }, "role_preview.ended", { entityType: "Role", entityId: user.preview.role });
  return { ok: true, home: workspaceFor(realRoleOf(user) ?? "OWNER") };
});
