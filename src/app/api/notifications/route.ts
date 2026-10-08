import { z } from "zod";
import { readJson, route } from "@/lib/api/handler";
import { listNotifications, markNotificationsRead } from "@/features/notifications/service";

export const GET = route({}, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  return listNotifications(actor, { page: Number(sp.get("page") ?? 1) || 1, pageSize: Number(sp.get("pageSize") ?? 20) || 20, unreadOnly: sp.get("unread") === "true" });
});

/** Mark notifications read: { ids?: string[] } — omit ids to mark all. */
export const POST = route({}, async ({ req, actor }) => {
  const { ids } = z.object({ ids: z.array(z.string()).max(200).optional() }).parse(await readJson(req));
  await markNotificationsRead(actor, ids);
  return { ok: true };
});
