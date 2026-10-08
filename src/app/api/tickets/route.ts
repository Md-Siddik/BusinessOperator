import { route, searchParamsObject } from "@/lib/api/handler";
import { formToObject, readUploads } from "@/lib/api/uploads";
import { RATE_LIMITS, enforceRateLimit } from "@/lib/rate-limit";
import { createTicket, listTickets } from "@/features/tickets/service";

export const GET = route({}, async ({ req, actor }) => listTickets(actor, searchParamsObject(req)));

/** Create a request or ticket (multipart, optional attachments). */
export const POST = route({}, async ({ req, actor, ip }) => {
  const form = await req.formData();
  const files = await readUploads(form);
  if (files.length) enforceRateLimit(RATE_LIMITS.upload, ip);
  return createTicket(actor, formToObject(form), files);
});
