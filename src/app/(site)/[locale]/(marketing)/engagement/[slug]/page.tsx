import { notFound, permanentRedirect } from "next/navigation";
import { LANGUAGE_CODES, localizedPath } from "@/config/languages";
import { ENGAGEMENT_MODELS, engagementPath, getEngagementModelByLegacySlug } from "@/config/engagement";

type Params = { params: Promise<{ locale: string; slug: string }> };

/** Pre-render the redirects for the former addresses. */
export function generateStaticParams() {
  return LANGUAGE_CODES.flatMap((locale) => ENGAGEMENT_MODELS.map((m) => ({ locale, slug: m.legacySlug })));
}

/**
 * Former engagement detail addresses (/engagement/<slug>). The pages now live under
 * /how-we-work/<slug>; this permanent (308) redirect keeps old links, bookmarks and
 * emails working in every language.
 */
export default async function LegacyEngagementRedirect({ params }: Params) {
  const { locale, slug } = await params;
  const model = getEngagementModelByLegacySlug(slug);
  if (!model) notFound();
  permanentRedirect(localizedPath(locale, engagementPath(model)));
}
