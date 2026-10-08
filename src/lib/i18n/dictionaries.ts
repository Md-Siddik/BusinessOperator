import en from "@messages/en.json";
import de from "@messages/de.json";
import no from "@messages/no.json";
import sv from "@messages/sv.json";
import fi from "@messages/fi.json";
import da from "@messages/da.json";
import fr from "@messages/fr.json";
import { DEFAULT_LANGUAGE, isLanguageCode, type LanguageCode } from "@/config/languages";
import { connectToDatabase, isDatabaseConfigured } from "@/lib/db/connect";
import { Translation } from "@/models";
import { createTranslator, deepMerge, setPath, type Messages } from "./translator";

const DICTIONARIES: Record<LanguageCode, Messages> = { en, de, no, sv, fi, da, fr };

const baseCache = new Map<string, Messages>();

/** Locale dictionary merged over English, so every key always resolves. */
export function getBaseMessages(locale: string): Messages {
  const code = isLanguageCode(locale) ? locale : DEFAULT_LANGUAGE;
  let merged = baseCache.get(code);
  if (!merged) {
    merged = code === DEFAULT_LANGUAGE ? (en as Messages) : deepMerge(en as Messages, DICTIONARIES[code]);
    baseCache.set(code, merged);
  }
  return merged;
}

export function getRawDictionary(locale: LanguageCode): Messages {
  return DICTIONARIES[locale];
}

const OVERRIDE_TTL_MS = 60_000;
const g = globalThis as unknown as { __etTranslations?: Map<string, { at: number; values: { key: string; value: string }[] }> };
const overrideCache = (g.__etTranslations ??= new Map());

async function getOverrides(locale: string) {
  const hit = overrideCache.get(locale);
  if (hit && Date.now() - hit.at < OVERRIDE_TTL_MS) return hit.values;
  if (!isDatabaseConfigured()) return [];
  try {
    await connectToDatabase();
    const values = await Translation.find({ locale }).select("key value").lean<{ key: string; value: string }[]>();
    overrideCache.set(locale, { at: Date.now(), values });
    return values;
  } catch {
    return [];
  }
}

export function invalidateTranslationCache() {
  overrideCache.clear();
}

/** Final messages: English ← locale JSON ← admin overrides (English overrides also apply as fallback). */
export async function getMessages(locale: string): Promise<Messages> {
  const base = getBaseMessages(locale);
  const [enOverrides, localeOverrides] = await Promise.all([
    locale === DEFAULT_LANGUAGE ? Promise.resolve([]) : getOverrides(DEFAULT_LANGUAGE),
    getOverrides(locale),
  ]);
  if (!enOverrides.length && !localeOverrides.length) return base;
  const messages = structuredClone(base);
  const localeHas = (key: string) => (DICTIONARIES[locale as LanguageCode] ? hasKey(DICTIONARIES[locale as LanguageCode], key) : false);
  for (const o of enOverrides) if (!localeHas(o.key)) setPath(messages, o.key, o.value);
  for (const o of localeOverrides) setPath(messages, o.key, o.value);
  return messages;
}

function hasKey(obj: Messages, key: string) {
  let cur: unknown = obj;
  for (const part of key.split(".")) {
    if (cur === null || typeof cur !== "object") return false;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string";
}

export async function getTranslator(locale: string) {
  const messages = await getMessages(locale);
  return { ...createTranslator(messages), messages };
}
