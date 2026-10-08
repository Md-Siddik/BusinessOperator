import { route, searchParamsObject } from "@/lib/api/handler";
import { formToObject, readUploads } from "@/lib/api/uploads";
import { RATE_LIMITS, enforceRateLimit } from "@/lib/rate-limit";
import { listConversations, startConversation } from "@/features/chat/service";

/** List / search conversations the actor may access (client: own organization only). */
export const GET = route({}, async ({ req, actor }) => listConversations(actor, searchParamsObject(req)));

/** Start a conversation (multipart: subject, topic, body, files). */
export const POST = route({ rateLimit: RATE_LIMITS.message }, async ({ req, actor, ip }) => {
  const form = await req.formData();
  const files = await readUploads(form);
  if (files.length) enforceRateLimit(RATE_LIMITS.upload, ip);
  return startConversation(actor, formToObject(form), files);
});
