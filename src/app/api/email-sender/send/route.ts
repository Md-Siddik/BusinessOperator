import { readJson, route } from "@/lib/api/handler";
import { sendEmail } from "@/features/email-sender/service";

/**
 * Email Sender (OWNER ONLY): send one email to one recipient.
 * Server-side role check here and in the service; per-IP burst limit here, per-Owner
 * hourly/daily limits, cooldown and idempotency in the service.
 */
export const POST = route({ ownerOnly: true, rateLimit: { bucket: "email-sender-burst", limit: 10, windowMs: 60_000 } }, async ({ req, actor }) => sendEmail(actor, await readJson(req)));
