import type { ContactKind, CoverageLevel, OpportunityType, SourceClass } from "../constants";

/**
 * OpportunityProvider — the only contract between opportunity intelligence and an
 * external source. Rules for every implementation:
 *  - call real, documented endpoints only; never invent endpoints, fields or data
 *  - map only fields the source returns; leave the rest undefined (never fabricate dates)
 *  - declare capabilities honestly; an unsupported operation is simply absent
 *  - server-side only; credentials come from environment variables
 */

export type AccessType = "OPEN" | "API_KEY" | "OAUTH_CLIENT" | "TOKEN_ON_REQUEST" | "AGREEMENT";

/** How removal / closure can be detected for this source. */
export type RemovalDetection =
  /** The source explicitly reports removals (e.g. JobStream `removed: true`, NAV status INACTIVE). */
  | "EXPLICIT"
  /** The full listing is returned each run; absence in consecutive complete listings + direct check. */
  | "LISTING_DIFF"
  /** Only the published deadline is known; the source does not report closure. */
  | "DEADLINE_ONLY"
  | "NONE";

export type ProviderCapabilities = {
  incremental: boolean;
  pagination: boolean;
  publishedAt: boolean;
  updatedAt: boolean;
  deadline: boolean;
  removalDetection: RemovalDetection;
  /** A per-record status check exists (direct endpoint). */
  activityCheck: boolean;
  /** How employer/buyer identity is established. */
  employerIdentity: "REGISTRATION_NUMBER" | "ATS_BOARD_OWNER" | "OFFICIAL_DOMAIN" | "NAME_ONLY";
  contacts: boolean;
  webhooks: false;
  /** The source's records link to an employer/buyer-controlled application or submission page. */
  directApplyLink: boolean;
};

export type CountryCoverage = { code: string; level: CoverageLevel; note: string };

export type NormalizedContact = {
  kind: ContactKind;
  name?: string;
  role?: string;
  email?: string;
  phone?: string;
  url?: string;
  /** Published by a party other than the organization itself (e.g. a procurement agent). */
  thirdParty?: boolean;
};

/** Common shape every provider normalizes into. Undefined = the source did not provide it. */
export type NormalizedOpportunity = {
  externalId: string;
  type: OpportunityType;
  title: string;
  organization: { name?: string; registrationNumber?: string; registrationCountry?: string; website?: string };
  countryCode?: string;
  location?: string;
  summary?: string;
  sourceUrl?: string;
  /** Employer- or buyer-controlled application / submission URL. Never an aggregator redirect. */
  applyUrl?: string;
  /** Aggregator redirect or other third-party route. */
  thirdPartyUrl?: string;
  sourceClass: SourceClass;
  sourcePublisher: string;
  publishedAt?: Date;
  sourceUpdatedAt?: Date;
  deadline?: Date;
  deadlineText?: string;
  /** What the source itself says about activity right now, if anything. */
  sourceSaysActive?: boolean;
  sourceSaysClosed?: boolean;
  classification?: { scheme: string; codes?: string[]; labels?: string[] };
  jobCategory?: string;
  employmentType?: string;
  noticeKind?: string;
  contacts?: NormalizedContact[];
};

export type FeedLike = {
  _id: unknown;
  key: string;
  config: Record<string, unknown>;
  settings: Record<string, unknown>;
  cursor?: string | null;
};

export type FetchContext = {
  feed: FeedLike;
  cursor: string | null;
  /** Hard cap on records processed in this run (polite, bounded runs). */
  limit: number;
  signal?: AbortSignal;
  log: (msg: string) => void;
};

export type FetchResult = {
  items: NormalizedOpportunity[];
  /** External ids the source explicitly reports as removed / inactive. */
  removedIds?: string[];
  cursor?: string | null;
  /** False when the run stopped early (cap or page limit) — the cursor allows continuing. */
  complete: boolean;
  /** True when `items` is the source's COMPLETE current listing (enables listing-diff removal). */
  fullListing?: boolean;
  /** Records seen but outside the supported countries / configured scope. */
  outOfScope?: number;
};

export type ActivityCheckResult = {
  /** ACTIVE = source confirms listed; REMOVED/CLOSED = source says so; UNKNOWN = could not tell. */
  status: "ACTIVE" | "REMOVED" | "CLOSED" | "UNKNOWN";
  detail: string;
  /** True when the check itself failed (network, 5xx, rate limit) — never treated as closure. */
  failed?: boolean;
  deadline?: Date;
};

export type ConfigStatus = { ok: boolean; missing: string[]; message?: string };

export type FeedConfigField = { key: string; label: string; placeholder?: string; required?: boolean; help?: string };
export type SettingField = { key: string; label: string; help: string; kind: "list" | "text" | "number"; defaultValue: string | number };

export interface OpportunityProvider {
  id: string;
  name: string;
  /** Organization operating the source. */
  publisher: string;
  type: OpportunityType;
  defaultSourceClass: SourceClass;
  /** Employer feeds need per-employer config (board token, careers URL). */
  perEmployer: boolean;
  coverage: CountryCoverage[];
  /** Coverage applies to whatever employers the owner configures (any supported country). */
  employerScoped?: boolean;
  access: { type: AccessType; requiredEnv: string[]; signupUrl?: string; termsUrl?: string; termsNote: string };
  docsUrl: string;
  homepage: string;
  description: string;
  limitations: string;
  capabilities: ProviderCapabilities;
  /** How the integration was checked at build time — never claimed beyond what was done. */
  evidence: "REAL_DATA_TESTED" | "DOCUMENTED_NOT_TESTED";
  freshnessNote: string;
  recommendedIntervalMinutes: number;
  /** Terms require purging content once a record is inactive (e.g. NAV). */
  purgeOnRemoval?: boolean;
  /** Commercial use requires an agreement — enabling it is an explicit owner decision. */
  requiresAgreement?: boolean;
  feedConfigFields?: FeedConfigField[];
  settingFields?: SettingField[];

  isConfigured(): ConfigStatus;
  validateFeedConfig?(config: Record<string, unknown>): Record<string, unknown>;
  fetch(ctx: FetchContext): Promise<FetchResult>;
  checkActivity?(item: { externalId: string; sourceUrl?: string | null; deadline?: Date | null }, feed: FeedLike, signal?: AbortSignal): Promise<ActivityCheckResult>;
}

/** Shape safe to send to the browser (no functions, no secrets — env var NAMES only). */
export type OpportunityProviderSummary = Omit<OpportunityProvider, "isConfigured" | "validateFeedConfig" | "fetch" | "checkActivity"> & { configured: ConfigStatus; hasActivityCheck: boolean };

export function summarizeOpportunityProvider(p: OpportunityProvider): OpportunityProviderSummary {
  const rest = Object.fromEntries(Object.entries(p).filter(([, v]) => typeof v !== "function")) as Omit<OpportunityProvider, "isConfigured" | "validateFeedConfig" | "fetch" | "checkActivity">;
  return { ...rest, configured: p.isConfigured(), hasActivityCheck: !!p.checkActivity };
}
