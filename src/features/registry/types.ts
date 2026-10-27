import type { Day } from "@/lib/dates/country-time";

/**
 * CompanyRegistryProvider — the only contract between company intelligence
 * and an external data source. One provider serves one country.
 *
 * Rules for every implementation:
 *  - call real, documented endpoints only; never invent endpoints or data
 *  - map only fields the source actually returns; leave the rest undefined
 *  - declare honest capabilities and data freshness
 *  - run server-side only; credentials come from environment variables
 */

/** How current the source itself is. Never claim REAL_TIME for a periodic/bulk source. */
/**
 * Freshness definitions (documented, not marketing):
 *  REAL_TIME      — the source serves the live register on request, or streams changes as they happen
 *  NEAR_REAL_TIME — the source documents delivery within minutes (e.g. KVK: within 15 minutes)
 *  DAILY          — the source publishes about once a day
 *  PERIODIC       — weekly / monthly / irregular snapshots
 *  UNKNOWN        — not established
 * Polling a daily source more often never makes it REAL_TIME.
 */
export const DATA_FRESHNESS = ["REAL_TIME", "NEAR_REAL_TIME", "DAILY", "PERIODIC", "UNKNOWN"] as const;
export type DataFreshness = (typeof DATA_FRESHNESS)[number];

export const DATA_FRESHNESS_LABELS: Record<DataFreshness, string> = {
  REAL_TIME: "Real-time",
  NEAR_REAL_TIME: "Near real-time",
  DAILY: "Daily updated",
  PERIODIC: "Periodic / bulk",
  UNKNOWN: "Unknown freshness",
};

export const SOURCE_TYPES = ["OFFICIAL_REGISTRY", "OFFICIAL_OPEN_DATA", "COMMERCIAL", "DEMO"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  OFFICIAL_REGISTRY: "Official registry",
  OFFICIAL_OPEN_DATA: "Official open data",
  COMMERCIAL: "Commercial provider",
  DEMO: "Demo data",
};

export type ProviderCapabilities = {
  /** Can list companies registered on a given day / range. Required for the daily view. */
  supportsDailyRegistrations: boolean;
  supportsRealTimeSearch: boolean;
  supportsDailyUpdates: boolean;
  supportsRegistrationDate: boolean;
  supportsLookup: boolean;
  supportsEmail: boolean;
  supportsPhone: boolean;
  supportsMobile: boolean;
  supportsWebsite: boolean;
  supportsAddress: boolean;
  supportsIndustry: boolean;
  supportsDirectors: boolean;
  supportsRoles: boolean;
  supportsSourceUrl: boolean;
};

export const NO_CAPABILITIES: ProviderCapabilities = {
  supportsDailyRegistrations: false,
  supportsRealTimeSearch: false,
  supportsDailyUpdates: false,
  supportsRegistrationDate: false,
  supportsLookup: false,
  supportsEmail: false,
  supportsPhone: false,
  supportsMobile: false,
  supportsWebsite: false,
  supportsAddress: false,
  supportsIndustry: false,
  supportsDirectors: false,
  supportsRoles: false,
  supportsSourceUrl: false,
};

export type NormalizedPerson = {
  name: string;
  role: string;
  roleCode?: string;
  /** e.g. "Board", "Management", "Contact person" */
  group?: string;
};

export type NormalizedAddress = {
  street?: string;
  postalCode?: string;
  city?: string;
  /** Municipality / county / region as published by the source. */
  region?: string;
  country?: string;
};

/** Common shape every provider normalizes into. Undefined = the source did not provide it. */
export type NormalizedCompany = {
  identity: {
    sourceId: string;
    name: string;
    registrationNumber?: string;
  };
  registration: {
    /** The registry's own registration day, in the country's local calendar. */
    registrationDay?: Day;
    incorporationDay?: Day;
    status?: string;
    legalForm?: string;
    legalFormCode?: string;
  };
  classification: {
    industryCode?: string;
    industryDescription?: string;
    /** Original classification system, e.g. "SN2007 (NACE)", "TOL 2008", "SIC 2007", "NAF rév. 2", "DB07". */
    codeSystem?: string;
    /** Normalized NACE-style code used for cross-country industry grouping, when derivable. */
    naceCode?: string;
    businessActivity?: string;
    purpose?: string;
  };
  contact: {
    email?: string;
    phone?: string;
    mobile?: string;
    website?: string;
  };
  address: {
    business?: NormalizedAddress;
    postal?: NormalizedAddress;
  };
  people?: NormalizedPerson[];
  /** Person the registry marks as contact / managing director, when available. */
  contactPerson?: NormalizedPerson;
  employees?: number;
  /** Source-level flags that restrict marketing use (e.g. Danish "reklamebeskyttet", KVK non-mailing). */
  marketingProtected?: boolean;
  marketingRestrictionReason?: string;
  /** NEW_ENTITY (default) | BRANCH | NAME_CHANGE | RELOCATION | CONTINUATION | CONVERSION | UNKNOWN */
  eventType?: string;
  source: {
    url?: string;
    updatedAt?: Date;
    /** When the source registered / published the event (timestamp), if it says. */
    publishedAt?: Date;
    /** Raw provider record, kept server-side for debugging/re-normalization. Never sent to clients. */
    raw?: unknown;
  };
};

export type RegistrationBatch = {
  companies: NormalizedCompany[];
  /** Total records the source reports for the window (may exceed what was fetched). */
  total?: number;
  /** False when the window was truncated by the per-run cap. */
  complete: boolean;
};

export type AccessType = "OPEN" | "API_KEY" | "AGREEMENT" | "COMMERCIAL" | "NONE";

export type ChangeBatch = {
  newCompanies: NormalizedCompany[];
  changedIds: string[];
  removedIds: string[];
  cursor: string;
  /** Source publication times of processed events (for observed-delay metrics). */
  publishedAts: Date[];
  more: boolean;
};

export type ProviderStatus = {
  state: "CONNECTED" | "UNAVAILABLE" | "CREDENTIALS_REQUIRED" | "NOT_CONNECTED";
  message?: string;
  checkedAt: Date;
};

export type FetchContext = {
  /** Max records to fetch in one call (avoid aggressive crawling). */
  limit: number;
  signal?: AbortSignal;
  log?: (msg: string) => void;
};

export interface CompanyRegistryProvider {
  id: string;
  countryCode: string;
  /** Display name, e.g. "Brønnøysundregistrene (Enhetsregisteret)". */
  name: string;
  /** Source name shown on every company, e.g. "Brønnøysundregistrene". */
  sourceName: string;
  sourceType: SourceType;
  freshness: DataFreshness;
  isDemo: boolean;
  /** How access is obtained — decides "Needs credentials" vs "Needs approval". */
  accessType?: AccessType;
  /** What the registration date means at this source (shown next to every date). */
  registrationDateType?: string;
  /** For placeholder providers: the jurisdiction catalogue state. */
  catalogueState?: string;
  homepage: string;
  docsUrl?: string;
  description: string;
  /** Short note shown in the UI about what the source does not provide. */
  limitations?: string;
  capabilities: ProviderCapabilities;
  /** Environment variables this provider needs (names only — values never leave the server). */
  requiredEnv: string[];
  isConfigured(): boolean;
  /** Recommended scheduled sync interval, respecting the source's update cadence and limits. */
  recommendedSyncMinutes: number;
  /**
   * Days an incremental sync re-reads behind the last successful day (default 1). Sources that
   * publish registrations with a lag of several days need a longer look-back, or late records
   * would never be fetched. Re-reading is safe: records are upserted by registry id.
   */
  lookbackDays?: number;

  /**
   * What getRegistrations' day window selects. "registration" (default): companies
   * registered in the window. "publication": entries the source PUBLISHED in the window,
   * each carrying its real (earlier) registration day — for sources that publish with a lag.
   */
  windowBy?: "registration" | "publication";
  /** Companies registered between two local days (inclusive), or published, see windowBy. */
  getRegistrations?(from: Day, to: Day, ctx: FetchContext): Promise<RegistrationBatch>;
  /** Fetch one company by registration number. */
  getCompany?(registrationNumber: string, ctx?: Pick<FetchContext, "signal">): Promise<NormalizedCompany | null>;
  /** People / roles for one company, when the source exposes them separately. */
  getPeople?(registrationNumber: string, ctx?: Pick<FetchContext, "signal">): Promise<{ people: NormalizedPerson[]; contactPerson?: NormalizedPerson }>;
  searchCompanies?(query: { name?: string; registrationNumber?: string }, ctx?: Pick<FetchContext, "signal">): Promise<NormalizedCompany[]>;
  /**
   * Incremental change feed (source-permitted polling). cursor null = initialise
   * at "now" without processing. Returns new companies, ids of known entities
   * that changed, ids the source requires us to remove, and the next cursor.
   */
  pollChanges?(cursor: string | null, ctx: FetchContext): Promise<ChangeBatch>;
  /** Seconds between polls (respecting the source's limits). */
  feedIntervalSeconds?: number;
  /** When the source last published data (e.g. dataset modification time). */
  getLatestPublication?(): Promise<Date | null>;
  /** Cheap reachability check. */
  checkStatus(): Promise<ProviderStatus>;
}

/** Shape safe to send to the browser. */
export type ProviderSummary = Pick<
  CompanyRegistryProvider,
  "id" | "countryCode" | "name" | "sourceName" | "sourceType" | "freshness" | "isDemo" | "accessType" | "registrationDateType" | "catalogueState" | "homepage" | "docsUrl" | "description" | "limitations" | "capabilities" | "requiredEnv" | "recommendedSyncMinutes"
> & { configured: boolean };

export function summarizeProvider(p: CompanyRegistryProvider): ProviderSummary {
  return {
    id: p.id,
    countryCode: p.countryCode,
    name: p.name,
    sourceName: p.sourceName,
    sourceType: p.sourceType,
    freshness: p.freshness,
    isDemo: p.isDemo,
    accessType: p.accessType,
    registrationDateType: p.registrationDateType,
    catalogueState: p.catalogueState,
    homepage: p.homepage,
    docsUrl: p.docsUrl,
    description: p.description,
    limitations: p.limitations,
    capabilities: p.capabilities,
    requiredEnv: p.requiredEnv,
    recommendedSyncMinutes: p.recommendedSyncMinutes,
    configured: p.isConfigured(),
  };
}
