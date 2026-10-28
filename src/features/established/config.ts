import "server-only";
import { z } from "zod";
import { SystemSetting } from "@/models";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { isOwner, type Actor } from "@/lib/permissions";

/**
 * Old company Intelligence criteria — independent of Startup Company Intelligence and of the
 * shared Company Type thresholds. Stored in SystemSetting "established.config"; the env var
 * ESTABLISHED_MIN_AGE_YEARS overrides the stored value (deployment-level pin).
 */
export const DEFAULT_MIN_AGE_YEARS = 5;
const KEY = "established.config";

export const establishedConfigSchema = z.object({ minAgeYears: z.coerce.number().int().min(1).max(100) }).strict();
export type EstablishedConfig = z.infer<typeof establishedConfigSchema> & { pinnedByEnv: boolean };

export async function getEstablishedConfig(): Promise<EstablishedConfig> {
  const env = Number(process.env.ESTABLISHED_MIN_AGE_YEARS);
  if (Number.isInteger(env) && env >= 1 && env <= 100) return { minAgeYears: env, pinnedByEnv: true };
  const doc = await SystemSetting.findOne({ key: KEY }).lean<{ value?: unknown }>();
  const parsed = establishedConfigSchema.safeParse(doc?.value ?? {});
  return { minAgeYears: parsed.success ? parsed.data.minAgeYears : DEFAULT_MIN_AGE_YEARS, pinnedByEnv: false };
}

/** Owner only. Raising the threshold hides younger records at once (the list applies it on read). */
export async function setEstablishedConfig(actor: Actor, input: unknown) {
  if (!isOwner(actor)) throw Errors.forbidden();
  const value = establishedConfigSchema.parse(input);
  if (Number.isInteger(Number(process.env.ESTABLISHED_MIN_AGE_YEARS))) throw Errors.badRequest("The age threshold is pinned by ESTABLISHED_MIN_AGE_YEARS on this deployment.");
  await SystemSetting.updateOne({ key: KEY }, { $set: { value, updatedBy: actor.id } }, { upsert: true });
  await audit(actor, "established.config_changed", { entityType: "SystemSetting", metadata: value });
  return getEstablishedConfig();
}

/** The cut-off date for a threshold: companies founded on or before it qualify. */
export function foundedCutoff(minAgeYears: number, now = new Date()) {
  return new Date(now.getTime() - minAgeYears * 365.25 * 86_400_000);
}
