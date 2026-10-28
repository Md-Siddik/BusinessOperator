import { z } from "zod";
import { readJson, route } from "@/lib/api/handler";
import { marketerTableState, sendLeadToMarketer } from "@/features/marketer/service";

/** Owner only: is this company in the Digital Marketer table, and how many marketers can see it? */
export const GET = route({ internal: true, ownerOnly: true, permission: "leads.sendToMarketer" }, async ({ req, actor }) => marketerTableState(actor, req.nextUrl.searchParams.get("companyId") ?? ""));

/** Owner only: add a company (lead) to the shared Digital Marketer table. Idempotent per company. */
export const POST = route({ internal: true, ownerOnly: true, permission: "leads.sendToMarketer" }, async ({ req, actor }) => {
  const body = z.object({ companyId: z.string() }).parse(await readJson(req));
  return sendLeadToMarketer(actor, body.companyId);
});
