/**
 * The three commercial engagement models (separate from the six service categories).
 * `key` matches the contact form's `engagement` value and the "engagement.models.*" copy.
 */
export const ENGAGEMENT_MODELS = [
  { key: "monthly", slug: "monthly-partnership" },
  { key: "growth", slug: "growth-partnership" },
  { key: "project", slug: "task-based" },
] as const;

export type EngagementModelConfig = (typeof ENGAGEMENT_MODELS)[number];

export const ENGAGEMENT_SLUGS = ENGAGEMENT_MODELS.map((m) => m.slug);

export function getEngagementModel(slug: string): EngagementModelConfig | undefined {
  return ENGAGEMENT_MODELS.find((m) => m.slug === slug);
}
