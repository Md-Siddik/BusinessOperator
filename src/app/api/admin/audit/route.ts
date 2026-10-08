import { route } from "@/lib/api/handler";
import { listAuditLogs } from "@/features/users/service";

export const GET = route({ internal: true, permission: "audit.view" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  return listAuditLogs(actor, { action: sp.get("action") ?? undefined, q: sp.get("q") ?? undefined, page: Number(sp.get("page") ?? 1) || 1 });
});
