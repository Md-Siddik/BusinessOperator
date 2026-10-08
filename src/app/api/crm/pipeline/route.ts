import { route } from "@/lib/api/handler";
import { getPipeline } from "@/features/crm/service";

export const GET = route({ internal: true, permission: "companies.read" }, async ({ req, actor }) =>
  getPipeline(actor, req.nextUrl.searchParams.get("country") ?? "ALL", { mine: req.nextUrl.searchParams.get("mine") === "true" }),
);
