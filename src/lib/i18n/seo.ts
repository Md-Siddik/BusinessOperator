import type { Metadata } from "next";
import { LANGUAGES, getLanguage, localizedPath } from "@/config/languages";
import { absoluteUrl, siteConfig } from "@/config/site";

/** hreflang alternates for a public path across every supported language (+ x-default). */
export function languageAlternates(path: string, enabled: string[] = LANGUAGES.map((l) => l.code)) {
  const languages: Record<string, string> = {};
  for (const lang of LANGUAGES) {
    if (!enabled.includes(lang.code)) continue;
    languages[lang.hreflang] = absoluteUrl(localizedPath(lang.code, path));
  }
  languages["x-default"] = absoluteUrl(localizedPath("en", path));
  return languages;
}

/** Localized metadata: title, description, canonical, hreflang and Open Graph. */
export function buildMetadata(opts: { locale: string; path: string; title: string; description: string; noIndex?: boolean; enabledLanguages?: string[] }): Metadata {
  const url = absoluteUrl(localizedPath(opts.locale, opts.path));
  const lang = getLanguage(opts.locale);
  return {
    title: opts.title,
    description: opts.description,
    alternates: { canonical: url, languages: languageAlternates(opts.path, opts.enabledLanguages) },
    openGraph: {
      type: "website",
      url,
      title: opts.title,
      description: opts.description,
      siteName: siteConfig.name,
      locale: lang.ogLocale,
      alternateLocale: LANGUAGES.filter((l) => l.code !== lang.code).map((l) => l.ogLocale),
    },
    twitter: { card: "summary_large_image", title: opts.title, description: opts.description },
    robots: opts.noIndex ? { index: false, follow: false } : undefined,
  };
}
