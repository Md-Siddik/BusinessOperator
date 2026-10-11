/**
 * Verified Opportunity Intelligence — shared enums, labels and definitions.
 * Client-safe (no server imports). Owner-only module: nothing here is secret,
 * but every record and action is gated server-side on the OWNER role.
 *
 * Trust model: source classification, employer identity, activity status and
 * manual review are SEPARATE dimensions. They are never collapsed into one
 * "verified" badge — an official source can still be unconfirmed as active.
 */

export const OPPORTUNITY_TYPES = ["HIRING", "PROCUREMENT"] as const;
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];
export const OPPORTUNITY_TYPE_LABELS: Record<OpportunityType, string> = {
  HIRING: "Hiring",
  PROCUREMENT: "Service & project",
};

/** Who published the record we hold. */
export const SOURCE_CLASSES = [
  "OFFICIAL_EMPLOYER_SOURCE",
  "OFFICIAL_EMPLOYER_ATS",
  "OFFICIAL_PROCUREMENT_PORTAL",
  "OFFICIAL_PUBLIC_EMPLOYMENT_SERVICE",
  "OFFICIAL_COMPANY_ANNOUNCEMENT",
  "THIRD_PARTY_AGGREGATOR",
  "UNVERIFIED_SOURCE",
] as const;
export type SourceClass = (typeof SOURCE_CLASSES)[number];
export const SOURCE_CLASS_LABELS: Record<SourceClass, string> = {
  OFFICIAL_EMPLOYER_SOURCE: "Official employer source",
  OFFICIAL_EMPLOYER_ATS: "Official employer ATS",
  OFFICIAL_PROCUREMENT_PORTAL: "Official procurement portal",
  OFFICIAL_PUBLIC_EMPLOYMENT_SERVICE: "Public employment service",
  OFFICIAL_COMPANY_ANNOUNCEMENT: "Official company announcement",
  THIRD_PARTY_AGGREGATOR: "Third-party aggregator",
  UNVERIFIED_SOURCE: "Unverified source",
};
export const SOURCE_CLASS_HELP: Record<SourceClass, string> = {
  OFFICIAL_EMPLOYER_SOURCE: "Published on a careers page on the employer's own official domain.",
  OFFICIAL_EMPLOYER_ATS: "Published on the employer's public applicant-tracking-system job board (Greenhouse, Lever, Ashby).",
  OFFICIAL_PROCUREMENT_PORTAL: "Published by an authoritative public procurement portal (TED, Find a Tender, Contracts Finder, BOAMP).",
  OFFICIAL_PUBLIC_EMPLOYMENT_SERVICE: "Posted to a national public employment service (e.g. Arbetsförmedlingen, NAV, France Travail). The posting party may be the employer or an agency acting for it.",
  OFFICIAL_COMPANY_ANNOUNCEMENT: "An announcement on the organization's official channel that explicitly invites proposals.",
  THIRD_PARTY_AGGREGATOR: "Re-published by a job aggregator. The original employer posting has not been established.",
  UNVERIFIED_SOURCE: "The publisher could not be established.",
};
/** Dedup canonical preference: lower = preferred as the canonical record of a duplicate group. */
export const SOURCE_PRIORITY: Record<SourceClass, number> = {
  OFFICIAL_EMPLOYER_SOURCE: 1,
  OFFICIAL_EMPLOYER_ATS: 2,
  OFFICIAL_PROCUREMENT_PORTAL: 3,
  OFFICIAL_COMPANY_ANNOUNCEMENT: 4,
  OFFICIAL_PUBLIC_EMPLOYMENT_SERVICE: 5,
  THIRD_PARTY_AGGREGATOR: 8,
  UNVERIFIED_SOURCE: 9,
};
export const OFFICIAL_SOURCE_CLASSES: SourceClass[] = ["OFFICIAL_EMPLOYER_SOURCE", "OFFICIAL_EMPLOYER_ATS", "OFFICIAL_PROCUREMENT_PORTAL", "OFFICIAL_PUBLIC_EMPLOYMENT_SERVICE", "OFFICIAL_COMPANY_ANNOUNCEMENT"];

/** Employer / buyer identity — separate from whether the source is official. */
export const EMPLOYER_IDENTITY = ["CONFIRMED", "REGISTRATION_NUMBER_PROVIDED", "NOT_CONFIRMED"] as const;
export type EmployerIdentity = (typeof EMPLOYER_IDENTITY)[number];
export const EMPLOYER_IDENTITY_LABELS: Record<EmployerIdentity, string> = {
  CONFIRMED: "Employer identity confirmed",
  REGISTRATION_NUMBER_PROVIDED: "Registration number supplied by source",
  NOT_CONFIRMED: "Employer identity not confirmed",
};

/**
 * Activity status (documented definitions):
 *  ACTIVE  — the source currently lists the posting (seen in a successful listing,
 *            stream or direct status check) and no source-provided deadline has passed.
 *  EXPIRED — a deadline published by the source has passed.
 *  CLOSED  — the source explicitly marks it closed, cancelled or removed.
 *  UNKNOWN — activity cannot currently be confirmed (source unreachable, stale, or the
 *            source offers no reliable way to check). Never inferred as closed.
 */
export const ACTIVITY_STATUSES = ["ACTIVE", "EXPIRED", "CLOSED", "UNKNOWN"] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];
export const ACTIVITY_LABELS: Record<ActivityStatus, string> = {
  ACTIVE: "Active (checked)",
  EXPIRED: "Expired (deadline passed)",
  CLOSED: "Closed / removed at source",
  UNKNOWN: "Activity unknown",
};

/** Source listing state, from the last successful contact with the source. */
export const SOURCE_STATES = ["LISTED", "REMOVED_AT_SOURCE", "UNKNOWN"] as const;
export type SourceState = (typeof SOURCE_STATES)[number];

/**
 * Verification labels shown as separate badges (filterable). Derived from the
 * dimensions above — see `deriveLabels` in features/opportunities/verification.ts.
 */
export const VERIFICATION_LABELS = [
  "VERIFIED_OFFICIAL_SOURCE",
  "EMPLOYER_IDENTITY_CONFIRMED",
  "ACTIVE_STATUS_CHECKED",
  "NEEDS_MANUAL_REVIEW",
  "UNVERIFIED",
  "CLOSED_OR_EXPIRED",
  "REMOVED_AT_SOURCE",
] as const;
export type VerificationLabel = (typeof VERIFICATION_LABELS)[number];
export const VERIFICATION_LABEL_TEXT: Record<VerificationLabel, string> = {
  VERIFIED_OFFICIAL_SOURCE: "Verified official source",
  EMPLOYER_IDENTITY_CONFIRMED: "Employer identity confirmed",
  ACTIVE_STATUS_CHECKED: "Active status checked",
  NEEDS_MANUAL_REVIEW: "Needs manual review",
  UNVERIFIED: "Unverified",
  CLOSED_OR_EXPIRED: "Closed or expired",
  REMOVED_AT_SOURCE: "Removed at source",
};

/** How the owner can act on an opportunity — each derived only from source evidence. */
export const CONTACT_ROUTES = [
  "DIRECT_APPLICATION",
  "PROCUREMENT_SUBMISSION",
  "OFFICIAL_COMPANY_CHANNEL",
  "NAMED_CONTACT_ON_NOTICE",
  "THIRD_PARTY_ROUTE",
  "NONE",
] as const;
export type ContactRoute = (typeof CONTACT_ROUTES)[number];
export const CONTACT_ROUTE_LABELS: Record<ContactRoute, string> = {
  DIRECT_APPLICATION: "Direct application link",
  PROCUREMENT_SUBMISSION: "Official procurement submission link",
  OFFICIAL_COMPANY_CHANNEL: "Official organization contact channel",
  NAMED_CONTACT_ON_NOTICE: "Named contact published on the notice",
  THIRD_PARTY_ROUTE: "Third-party application / contact route",
  NONE: "No direct contact route found",
};

export const CONTACT_KINDS = ["NAMED_PERSON", "ORGANIZATION_EMAIL", "ORGANIZATION_PHONE", "ORGANIZATION_WEBSITE", "APPLICATION_EMAIL", "APPLICATION_LINK", "SUBMISSION_LINK"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export const REVIEW_STATUSES = ["NEW", "REVIEWING", "RELEVANT", "NOT_RELEVANT", "PURSUING", "ARCHIVED"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  NEW: "New",
  REVIEWING: "Reviewing",
  RELEVANT: "Relevant",
  NOT_RELEVANT: "Not relevant",
  PURSUING: "Pursuing",
  ARCHIVED: "Archived",
};

export const MANUAL_VERIFICATION_RESULTS = ["CONFIRMED_GENUINE", "CANNOT_CONFIRM", "NOT_GENUINE"] as const;
export type ManualVerificationResult = (typeof MANUAL_VERIFICATION_RESULTS)[number];
export const MANUAL_VERIFICATION_LABELS: Record<ManualVerificationResult, string> = {
  CONFIRMED_GENUINE: "Owner confirmed genuine",
  CANNOT_CONFIRM: "Owner could not confirm",
  NOT_GENUINE: "Owner judged not genuine",
};

/** ExploreTechify service categories (for relevance; derived from published classifications only). */
export const SERVICE_CATEGORIES = [
  "WEB_DEVELOPMENT",
  "ECOMMERCE",
  "SOFTWARE_DEVELOPMENT",
  "IT_CONSULTING_SUPPORT",
  "AUTOMATION_SYSTEMS",
  "CRM",
  "SEO_DIGITAL_VISIBILITY",
  "DIGITAL_MARKETING",
  "DATA_ANALYTICS",
  "RECRUITMENT_HR",
  "OTHER",
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];
export const SERVICE_CATEGORY_LABELS: Record<ServiceCategory, string> = {
  WEB_DEVELOPMENT: "Website development",
  ECOMMERCE: "E-commerce",
  SOFTWARE_DEVELOPMENT: "Software development",
  IT_CONSULTING_SUPPORT: "IT consulting & support",
  AUTOMATION_SYSTEMS: "Automation & business systems",
  CRM: "CRM",
  SEO_DIGITAL_VISIBILITY: "SEO & digital visibility",
  DIGITAL_MARKETING: "Digital marketing",
  DATA_ANALYTICS: "Data & analytics",
  RECRUITMENT_HR: "Recruitment & HR",
  OTHER: "Other",
};

/** Integration state of one provider (or one employer feed). */
export const PROVIDER_STATES = ["OPERATIONAL", "CONFIGURED_NOT_SYNCED", "DISABLED", "NEEDS_CREDENTIALS", "NEEDS_AGREEMENT", "PROVIDER_ERROR", "NOT_IMPLEMENTED"] as const;
export type ProviderState = (typeof PROVIDER_STATES)[number];
export const PROVIDER_STATE_LABELS: Record<ProviderState, string> = {
  OPERATIONAL: "Operational",
  CONFIGURED_NOT_SYNCED: "Configured · not synced yet",
  DISABLED: "Disabled",
  NEEDS_CREDENTIALS: "Needs credentials",
  NEEDS_AGREEMENT: "Needs agreement / owner decision",
  PROVIDER_ERROR: "Provider error",
  NOT_IMPLEMENTED: "Not implemented",
};

/** Country × type operational state. */
export const COUNTRY_SUPPORT = ["FULLY_OPERATIONAL", "PARTIALLY_OPERATIONAL", "NOT_CONFIGURED"] as const;
export type CountrySupport = (typeof COUNTRY_SUPPORT)[number];
export const COUNTRY_SUPPORT_LABELS: Record<CountrySupport, string> = {
  FULLY_OPERATIONAL: "Fully operational",
  PARTIALLY_OPERATIONAL: "Partially operational",
  NOT_CONFIGURED: "Not yet configured",
};

/** Coverage a provider gives a country. */
export const COVERAGE_LEVELS = ["NATIONAL_OFFICIAL", "PARTIAL", "SELECTED_EMPLOYERS"] as const;
export type CoverageLevel = (typeof COVERAGE_LEVELS)[number];
export const COVERAGE_LABELS: Record<CoverageLevel, string> = {
  NATIONAL_OFFICIAL: "National official source",
  PARTIAL: "Partial coverage",
  SELECTED_EMPLOYERS: "Selected employers only",
};

/** Which timestamp a date filter applies to — always stated in the UI. */
export const DATE_FIELDS = ["discovered", "published", "checked", "deadline"] as const;
export type DateField = (typeof DATE_FIELDS)[number];
export const DATE_FIELD_LABELS: Record<DateField, string> = {
  discovered: "First discovered by ExploreTechify",
  published: "Original publication date (from source)",
  checked: "Last confirmed at source",
  deadline: "Application / tender deadline",
};
export const DATE_FIELD_PATHS: Record<DateField, string> = {
  discovered: "firstSeenAt",
  published: "publishedAt",
  checked: "lastSeenAt",
  deadline: "deadline",
};
export const OPP_DATE_PRESETS = ["today", "7d", "30d", "custom"] as const;
export type OppDatePreset = (typeof OPP_DATE_PRESETS)[number];

/**
 * Metric definitions — the dashboard shows these exact definitions next to every number.
 * All metrics count canonical records only (duplicates are folded into their group).
 */
export const METRIC_DEFINITIONS = {
  discovered: "Opportunities first discovered by ExploreTechify in the selected period (by discovery timestamp, not publication date).",
  activeChecked: "Activity status ACTIVE: currently listed by the source as of its last successful check, with no published deadline passed.",
  official: "Open (not closed/expired) opportunities whose publisher is an official employer, ATS, procurement portal or public employment service.",
  deadlines: "Open procurement opportunities with a source-published submission deadline in the next 14 days.",
  review: "Opportunities flagged for manual review that the owner has not yet assessed.",
  closed: "Opportunities whose deadline passed or that the source closed / removed.",
  duplicates: "Additional source records folded into an existing opportunity (same canonical URL, external id or strict fallback match).",
  syncFailures: "Failed synchronization runs in the selected period.",
  hiringOrgs: "Distinct hiring organizations among open hiring opportunities (an organization with ten postings counts once).",
} as const;

export const MAX_PAGE_SIZE = 100;
