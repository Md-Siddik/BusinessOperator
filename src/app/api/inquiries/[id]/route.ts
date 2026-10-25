import { readJson, route } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { getInquiry, respondToInquiry, updateInquiryStatus, clientInquiryAction } from "@/features/inquiries/service";
export const GET = route<{ id: string }>({}, async ({ actor, params }) => getInquiry(actor, params.id));
export const PATCH = route<{ id: string }>({ rateLimit: RATE_LIMITS.message }, async ({ actor, params, req }) => updateInquiryStatus(actor, params.id, await readJson(req)));
export const POST = route<{ id: string }>({ rateLimit: RATE_LIMITS.message }, async ({ actor, params, req }) => actor.role === "CLIENT" ? clientInquiryAction(actor, params.id, await readJson(req)) : respondToInquiry(actor, params.id, await readJson(req)));
