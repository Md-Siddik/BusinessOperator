import { z } from "zod";
import { route, searchParamsObject } from "@/lib/api/handler";
import { listFollowUps } from "@/features/crm/service";

export const GET = route({ internal: true, permission: "companies.read" }, async ({ req, actor }) => {
  const q = z.object({ country: z.string().default("ALL"), bucket: z.enum(["today", "overdue", "upcoming"]).default("today") }).parse(searchParamsObject(req));
  return listFollowUps(actor, q);
});
