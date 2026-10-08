import { z } from "zod";
import { readJson, route } from "@/lib/api/handler";
import { isDay } from "@/lib/dates/country-time";
import { countryCodeSchema } from "@/lib/validation";
import { startSync } from "@/features/registry/sync";

/**
 * Start a country-specific registry sync in the background. Returns at once
 * with a sync id; poll GET /api/registry/sync/{id} for progress.
 *   kind TODAY (default) — today's registrations in the country's timezone
 *   kind DATE            — one registry day (`date`)
 *   kind BACKFILL        — incremental catch-up since the last successful sync
 */
export const POST = route({ internal: true, permission: "registry.sync" }, async ({ req, actor }) => {
  const body = z
    .object({ country: countryCodeSchema, kind: z.enum(["TODAY", "DATE", "BACKFILL"]).default("TODAY"), date: z.string().refine(isDay, "Use YYYY-MM-DD").optional() })
    .parse(await readJson(req));
  return startSync({ countryCode: body.country, kind: body.kind, from: body.date, trigger: "MANUAL", actor });
});
