import { z } from "zod";
import { readJson, route } from "@/lib/api/handler";
import { previewEmail } from "@/features/email-sender/service";

/**
 * Email Sender (OWNER ONLY): render the exact email that would be sent.
 * `ownerOnly` rejects other roles (401/403); the service re-checks the role.
 */
export const POST = route({ ownerOnly: true }, async ({ req, actor }) => {
  const body = (await readJson(req)) as Record<string, unknown>;
  const to = z.string().max(254).optional().parse(body.to);
  return previewEmail(actor, body, to);
});
