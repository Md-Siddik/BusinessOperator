import { readJson, route } from "@/lib/api/handler";
import { Errors } from "@/lib/errors";
import { approveMessage, markReplied, rejectMessage, sendApprovedMessage, submitForReview } from "@/features/outreach/service";

type P = { id: string; action: string };

/** Draft → Review → Approve → Send workflow transitions (each permission-checked in the service). */
export const POST = route<P>({ internal: true }, async ({ req, actor, params }) => {
  switch (params.action) {
    case "submit":
      await submitForReview(actor, params.id);
      break;
    case "approve":
      await approveMessage(actor, params.id);
      break;
    case "reject":
      await rejectMessage(actor, params.id, await readJson(req));
      break;
    case "send":
      await sendApprovedMessage(actor, params.id);
      break;
    case "replied":
      await markReplied(actor, params.id);
      break;
    default:
      throw Errors.notFound();
  }
  return { ok: true };
});
