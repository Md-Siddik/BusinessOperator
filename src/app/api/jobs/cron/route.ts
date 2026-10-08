import crypto from "node:crypto";
import { route } from "@/lib/api/handler";
import { Errors } from "@/lib/errors";
import { fastTick } from "@/features/registry/scheduler";

/**
 * Fast worker tick for multi-instance / serverless deployments (REGISTRY_SCHEDULER=off):
 * live change feeds + durable job queue (contact research). Call every 30–60 s with
 *   Authorization: Bearer <CRON_SECRET>
 */
async function handler(req: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || provided.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret))) throw Errors.unauthorized();
  return fastTick(() => undefined);
}

export const GET = route({ auth: "none" }, async ({ req }) => handler(req));
export const POST = route({ auth: "none" }, async ({ req }) => handler(req));
