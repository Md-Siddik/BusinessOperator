import { z } from "zod";
import { LANGUAGE_CODES, type LanguageCode } from "@/config/languages";
import { Translation, type TranslationDoc } from "@/models";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { can, type Actor } from "@/lib/permissions";
import { getRawDictionary, invalidateTranslationCache } from "@/lib/i18n/dictionaries";
import { flattenMessages } from "@/lib/i18n/translator";

function requireContent(actor: Actor) {
  if (!can(actor, "content.manage")) throw Errors.forbidden();
}

export type TranslationRow = { key: string; english: string; base?: string; override?: string; status: "translated" | "missing" | "overridden" };

/** Translation editor rows for a namespace (e.g. "home", "services.categories.digitalFoundation"). */
export async function listTranslationRows(actor: Actor, locale: string, namespace: string, q?: string): Promise<TranslationRow[]> {
  requireContent(actor);
  if (!(LANGUAGE_CODES as string[]).includes(locale)) throw Errors.badRequest("Unknown language");
  const en = flattenMessages(getRawDictionary("en"));
  const base = flattenMessages(getRawDictionary(locale as LanguageCode));
  const overrides = await Translation.find({ locale }).lean<TranslationDoc[]>();
  const overrideMap = new Map(overrides.map((o) => [o.key, o.value]));
  const needle = q?.toLowerCase();
  return Object.keys(en)
    .filter((k) => !namespace || k === namespace || k.startsWith(`${namespace}.`))
    .filter((k) => !needle || k.toLowerCase().includes(needle) || en[k]!.toLowerCase().includes(needle) || (base[k] ?? "").toLowerCase().includes(needle))
    .slice(0, 400)
    .map((key) => {
      const override = overrideMap.get(key);
      return { key, english: en[key]!, base: base[key], override, status: override ? "overridden" : base[key] ? "translated" : "missing" };
    });
}

export const saveTranslationSchema = z.object({
  locale: z.enum(LANGUAGE_CODES as [string, ...string[]]),
  key: z.string().min(1).max(200),
  value: z.string().max(5000),
});

/** Save (or clear, with an empty value) an override. Only keys that exist in English can be overridden. */
export async function saveTranslation(actor: Actor, input: unknown) {
  requireContent(actor);
  const data = saveTranslationSchema.parse(input);
  const en = flattenMessages(getRawDictionary("en"));
  if (!(data.key in en)) throw Errors.badRequest("Unknown translation key");
  if (!data.value.trim()) await Translation.deleteOne({ locale: data.locale, key: data.key });
  else await Translation.updateOne({ locale: data.locale, key: data.key }, { $set: { value: data.value, updatedBy: actor.id, reviewed: true } }, { upsert: true });
  invalidateTranslationCache();
  await audit(actor, "translation.updated", { entityType: "Translation", entityId: `${data.locale}:${data.key}` });
}

export function translationNamespaces() {
  const en = getRawDictionary("en");
  const out: string[] = [];
  for (const [k, v] of Object.entries(en)) {
    if (k === "_meta") continue;
    out.push(k);
    if (k === "services" && v && typeof v === "object") {
      for (const cat of Object.keys((v as { categories: object }).categories)) out.push(`services.categories.${cat}`);
    }
  }
  return out;
}

export function translationCoverage() {
  const en = flattenMessages(getRawDictionary("en"));
  const total = Object.keys(en).length;
  return LANGUAGE_CODES.map((code) => {
    const dict = getRawDictionary(code);
    const flat = flattenMessages(dict);
    const meta = (dict as { _meta?: { reviewStatus?: string } })._meta;
    return { code, translated: Object.keys(en).filter((k) => flat[k]).length, total, reviewStatus: meta?.reviewStatus ?? "unknown" };
  });
}
