import { connectToDatabase, isDatabaseConfigured } from "@/lib/db/connect";
import { SystemSetting } from "@/models";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/permissions";
import { SETTING_SCHEMAS, type SettingKey, type SettingValue } from "./schemas";

/** Short in-process cache; settings change rarely and are read on many requests. */
const TTL_MS = 30_000;
const g = globalThis as unknown as { __etSettings?: Map<string, { at: number; value: unknown }> };
const cache = (g.__etSettings ??= new Map());

export function defaultSetting<K extends SettingKey>(key: K): SettingValue<K> {
  return SETTING_SCHEMAS[key].parse({}) as SettingValue<K>;
}

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as SettingValue<K>;
  if (!isDatabaseConfigured()) return defaultSetting(key);
  try {
    await connectToDatabase();
    const doc = await SystemSetting.findOne({ key }).lean<{ value: unknown }>();
    const parsed = SETTING_SCHEMAS[key].safeParse(doc?.value ?? {});
    const value = (parsed.success ? parsed.data : defaultSetting(key)) as SettingValue<K>;
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (err) {
    console.error(`[settings] failed to read "${key}", using defaults`, err);
    return defaultSetting(key);
  }
}

export async function updateSetting<K extends SettingKey>(key: K, input: unknown, actor: Actor): Promise<SettingValue<K>> {
  const value = SETTING_SCHEMAS[key].parse(input) as SettingValue<K>;
  await SystemSetting.updateOne({ key }, { $set: { value, updatedBy: actor.id } }, { upsert: true });
  cache.delete(key);
  await audit(actor, "settings.updated", { entityType: "SystemSetting", entityId: key });
  return value;
}

export function clearSettingsCache() {
  cache.clear();
}
