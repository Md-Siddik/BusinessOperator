import { z } from "zod";
import { readJson, route } from "@/lib/api/handler";
import { deliverySchema, eligibleMarketers, marketerTableState, sendLeadToMarketer } from "@/features/marketer/service";

/** Owner only: is this company in the Digital Marketer table, and how many marketers can see it? */
export const GET = route({ internal: true, ownerOnly: true, permission: "leads.sendToMarketer" }, async ({ req, actor }) => req.nextUrl.searchParams.get("eligible") === "true" ? eligibleMarketers(actor) : marketerTableState(actor, req.nextUrl.searchParams.get("companyId") ?? ""));

/** Owner only: add a company (lead) to the shared Digital Marketer table. Idempotent per company. */
export const POST = route({ internal: true, ownerOnly: true, permission: "leads.sendToMarketer" }, async ({ req, actor }) => {
  const body = z.object({ companyId: z.string().optional(), companyIds: z.array(z.string()).min(1).max(100).optional(), destinationType: z.enum(["shared", "individual"]).default("shared"), recipientId: z.string().optional() }).strict().refine((b) => !!b.companyId !== !!b.companyIds, "Provide companyId or companyIds").parse(await readJson(req));
  // Legacy callers sent a recipientId that the shared-table API ignored. Keep
  // that contract for shared delivery; private delivery always validates it.
  const delivery = deliverySchema.parse({ destinationType: body.destinationType, ...(body.destinationType === "individual" && body.recipientId && { recipientId: body.recipientId }) });
  if (body.companyId) return sendLeadToMarketer(actor, body.companyId, delivery);
  const results = [];
  for (const companyId of [...new Set(body.companyIds!)]) {
    try { results.push({ companyId, ok: true, ...await sendLeadToMarketer(actor, companyId, delivery) }); }
    catch (err) { results.push({ companyId, ok: false, error: err instanceof Error ? err.message : "Assignment failed" }); }
  }
  return { results };
});
