import { route } from "@/lib/api/handler";
import { ACCESS_MANAGER_PERMISSIONS, listAccess } from "@/features/access/service";

/** Accounts the actor may manage, with per-permission grant state and provenance. */
export const GET = route({ team: true, anyPermission: ACCESS_MANAGER_PERMISSIONS }, async ({ req, actor }) => ({
  users: await listAccess(actor, { q: req.nextUrl.searchParams.get("q") ?? undefined }),
}));
