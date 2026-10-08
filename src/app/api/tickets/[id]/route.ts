import { readJson, route } from "@/lib/api/handler";
import { Errors } from "@/lib/errors";
import { readUploads } from "@/lib/api/uploads";
import { RATE_LIMITS, enforceRateLimit } from "@/lib/rate-limit";
import { addTicketAttachments, addTicketComment, getTicket, updateTicket } from "@/features/tickets/service";

type P = { id: string };
export const GET = route<P>({}, async ({ actor, params }) => getTicket(actor, params.id));
export const PATCH = route<P>({}, async ({ req, actor, params }) => {
  await updateTicket(actor, params.id, await readJson(req));
  return { ok: true };
});

/** Add a comment (JSON) or attachments (multipart). */
export const POST = route<P>({}, async ({ req, actor, params, ip }) => {
  if (req.headers.get("content-type")?.includes("multipart/form-data")) {
    enforceRateLimit(RATE_LIMITS.upload, ip);
    const files = await readUploads(await req.formData());
    if (!files.length) throw Errors.badRequest("Choose a file to upload.");
    await addTicketAttachments(actor, params.id, files);
  } else {
    await addTicketComment(actor, params.id, await readJson(req));
  }
  return { ok: true };
});
