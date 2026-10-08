import { z } from "zod";
import { route, searchParamsObject } from "@/lib/api/handler";
import { getAnalytics } from "@/features/analytics/service";

export const GET = route({ internal: true, permission: "analytics.view" }, async ({ req, actor }) => {
  const q = z
    .object({ country: z.string().default("ALL"), days: z.coerce.number().int().min(7).max(365).default(90), granularity: z.enum(["day", "week", "month"]).optional() })
    .parse(searchParamsObject(req));
  return getAnalytics(actor, q);
});
