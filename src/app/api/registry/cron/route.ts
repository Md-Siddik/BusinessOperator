import crypto from "node:crypto";
import { route } from "@/lib/api/handler";
import { Errors } from "@/lib/errors";
import { slowTick } from "@/features/registry/scheduler";

/**
 * Scheduled jobs: due registry syncs + follow-up reminders.
 * Call from a scheduler (cron, Vercel Cron, Cloud Scheduler) with
 *   Authorization: Bearer <CRON_SECRET>
 */
async function handler(req: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || provided.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret))) throw Errors.unauthorized();
  return slowTick(() => undefined);
}

export const GET = route({ auth: "none" }, async ({ req }) => handler(req));
export const POST = route({ auth: "none" }, async ({ req }) => handler(req));
