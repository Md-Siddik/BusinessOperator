import { readJson, route } from "@/lib/api/handler";
import { formToObject, readUploads } from "@/lib/api/uploads";
import { RATE_LIMITS, enforceRateLimit } from "@/lib/rate-limit";
import { sendMessage } from "@/features/chat/service";

/** Send a message: JSON {body} or multipart (body + files). */
export const POST = route<{ id: string }>({ rateLimit: RATE_LIMITS.message }, async ({ req, actor, params, ip }) => {
  if (req.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await req.formData();
    const files = await readUploads(form);
    if (files.length) enforceRateLimit(RATE_LIMITS.upload, ip);
    return sendMessage(actor, params.id, formToObject(form), files);
  }
  return sendMessage(actor, params.id, await readJson(req));
});
