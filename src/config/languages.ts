/**
 * Website LANGUAGE configuration. Deliberately separate from COUNTRY
 * configuration (src/config/countries.ts): a country never implies a language.
 *
 * To add a language: add an entry here and a messages/<code>.json file.
 * Missing keys fall back to English automatically.
 */
export const LANGUAGES = [
  { code: "en", englishName: "English", nativeName: "English", hreflang: "en", ogLocale: "en_GB" },
  { code: "de", englishName: "German", nativeName: "Deutsch", hreflang: "de", ogLocale: "de_DE" },
  { code: "no", englishName: "Norwegian", nativeName: "Norsk", hreflang: "no", ogLocale: "nb_NO" },
  { code: "sv", englishName: "Swedish", nativeName: "Svenska", hreflang: "sv", ogLocale: "sv_SE" },
  { code: "fi", englishName: "Finnish", nativeName: "Suomi", hreflang: "fi", ogLocale: "fi_FI" },
  { code: "da", englishName: "Danish", nativeName: "Dansk", hreflang: "da", ogLocale: "da_DK" },
  { code: "fr", englishName: "French", nativeName: "Français", hreflang: "fr", ogLocale: "fr_FR" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];
export type LanguageDefinition = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: LanguageCode = "en";
export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as LanguageCode[];

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && (LANGUAGE_CODES as string[]).includes(value);
}

export function getLanguage(code: string): LanguageDefinition {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

/** Public path for a locale. English (default) uses clean, unprefixed URLs. */
export function localizedPath(locale: string, path = "/") {
  const clean = path === "/" ? "" : path.startsWith("/") ? path : `/${path}`;
  if (locale === DEFAULT_LANGUAGE) return clean || "/";
  return `/${locale}${clean}`;
}
