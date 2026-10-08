import { cache } from "react";
import { notFound } from "next/navigation";
import { isLanguageCode } from "@/config/languages";
import { getTranslator } from "@/lib/i18n/dictionaries";
import { getSetting } from "@/features/settings/service";

/** Everything a public page needs, memoised per request. Unknown or disabled locales 404. */
export const getPublicContext = cache(async (locale: string) => {
  if (!isLanguageCode(locale)) notFound();
  const [languages, general, translator] = await Promise.all([getSetting("languages"), getSetting("general"), getTranslator(locale)]);
  if (!languages.enabled.includes(locale)) notFound();
  return { locale, enabledLanguages: languages.enabled, general, ...translator };
});

export type LocaleParams = { params: Promise<{ locale: string }> };
