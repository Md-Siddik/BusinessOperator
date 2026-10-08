import { z } from "zod";
import { Types } from "mongoose";
import { readJson, route } from "@/lib/api/handler";
import { InboxItem } from "@/models";

/** Research inbox (internal users with company access only). */
export const GET = route({ internal: true, permission: "companies.read" }, async ({ req }) => {
  const archived = req.nextUrl.searchParams.get("archived") === "true";
  return InboxItem.find({ archivedAt: archived ? { $ne: null } : null }).sort({ createdAt: -1 }).limit(200).lean();
});

export const PATCH = route({ internal: true, permission: "companies.read" }, async ({ req }) => {
  const { ids, action } = z.object({ ids: z.array(z.string().refine((v) => Types.ObjectId.isValid(v))).max(500), action: z.enum(["read", "archive"]) }).parse(await readJson(req));
  await InboxItem.updateMany({ _id: { $in: ids } }, { $set: action === "read" ? { readAt: new Date() } : { archivedAt: new Date(), readAt: new Date() } });
  return { ok: true };
});
