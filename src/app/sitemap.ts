import type { MetadataRoute } from "next";
import { LANGUAGES, localizedPath } from "@/config/languages";
import { ENGAGEMENT_SLUGS } from "@/config/engagement";
import { SERVICE_SLUGS } from "@/config/services";
import { absoluteUrl } from "@/config/site";
import { listPublishedCaseStudies } from "@/features/content/service";
import { getSetting } from "@/features/settings/service";

export const revalidate = 3600;

/** One entry per page per enabled language, each with full hreflang alternates. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { enabled } = await getSetting("languages");
  const languages = LANGUAGES.filter((l) => enabled.includes(l.code));
  const cases = await listPublishedCaseStudies("en");
  const paths = ["/", "/services", ...SERVICE_SLUGS.map((s) => `/services/${s}`), "/how-we-work", ...ENGAGEMENT_SLUGS.map((s) => `/engagement/${s}`), "/about", "/work", ...cases.map((c) => `/work/${c.slug}`), "/contact"];
  const now = new Date();
  return paths.flatMap((path) =>
    languages.map((lang) => ({
      url: absoluteUrl(localizedPath(lang.code, path)),
      lastModified: now,
      changeFrequency: path === "/" ? ("weekly" as const) : ("monthly" as const),
      priority: path === "/" ? 1 : path.startsWith("/services") ? 0.8 : 0.6,
      alternates: { languages: Object.fromEntries(languages.map((l) => [l.hreflang, absoluteUrl(localizedPath(l.code, path))])) },
    })),
  );
}
