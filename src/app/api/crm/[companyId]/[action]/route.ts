import { readJson, route } from "@/lib/api/handler";
import { Errors } from "@/lib/errors";
import { addActivity, assignLead, changeStage, convertToClient, createFollowUp } from "@/features/crm/service";

type P = { companyId: string; action: string };

/** CRM actions on a lead: stage, assign, activity (note/call/…), follow-up, convert-to-client. */
export const POST = route<P>({ internal: true }, async ({ req, actor, params }) => {
  const body = params.action === "convert" ? {} : await readJson(req);
  switch (params.action) {
    case "stage":
      await changeStage(actor, params.companyId, body);
      return { ok: true };
    case "assign":
      await assignLead(actor, params.companyId, body);
      return { ok: true };
    case "activity":
      await addActivity(actor, params.companyId, body);
      return { ok: true };
    case "follow-up":
      return createFollowUp(actor, params.companyId, body);
    case "convert":
      return convertToClient(actor, params.companyId);
    default:
      throw Errors.notFound();
  }
});
