/**
 * The three commercial engagement models (separate from the services and from the
 * "Build before you commit" approach). `key` matches the contact form's `engagement` value
 * and the "engagement.models.*" copy.
 *
 * Detail pages live under /how-we-work/<slug>. `legacySlug` is the former /engagement/<slug>
 * address, permanently redirected so old links, bookmarks and emails keep working.
 */
export const ENGAGEMENT_MODELS = [
  { key: "monthly", slug: "monthly", legacySlug: "monthly-partnership" },
  { key: "project", slug: "task-based", legacySlug: "task-based" },
  { key: "growth", slug: "growth-partnership", legacySlug: "growth-partnership" },
] as const;

export type EngagementModelConfig = (typeof ENGAGEMENT_MODELS)[number];

export const ENGAGEMENT_SLUGS = ENGAGEMENT_MODELS.map((m) => m.slug);

/** Public path of an engagement detail page (unlocalised; wrap with localizedPath). */
export function engagementPath(model: Pick<EngagementModelConfig, "slug">) {
  return `/how-we-work/${model.slug}`;
}

export function getEngagementModel(slug: string): EngagementModelConfig | undefined {
  return ENGAGEMENT_MODELS.find((m) => m.slug === slug);
}

/** For the redirect from the former /engagement/<slug> addresses. */
export function getEngagementModelByLegacySlug(slug: string): EngagementModelConfig | undefined {
  return ENGAGEMENT_MODELS.find((m) => m.legacySlug === slug || m.slug === slug);
}

/** The "Build before you commit" page (an approach to reduce uncertainty — not a fourth payment model). */
export const BUILD_FIRST_PATH = "/how-we-work/build-first";
