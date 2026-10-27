import { z } from "zod";
import { readJson, route } from "@/lib/api/handler";
import { listMarketerRecipients, sendLeadToMarketer } from "@/features/marketer/service";

/** Owner only: Digital Marketers for the recipient picker, with this company's assignment state. */
export const GET = route({ internal: true, ownerOnly: true, permission: "leads.sendToMarketer" }, async ({ req, actor }) => ({
  recipients: await listMarketerRecipients(actor, req.nextUrl.searchParams.get("companyId") ?? ""),
}));

/** Owner only: send a lead (company) to a Digital Marketer. Idempotent per company + recipient. */
export const POST = route({ internal: true, ownerOnly: true, permission: "leads.sendToMarketer" }, async ({ req, actor }) => {
  const body = z.object({ companyId: z.string(), recipientId: z.string() }).parse(await readJson(req));
  return sendLeadToMarketer(actor, body.companyId, { recipientId: body.recipientId });
});
