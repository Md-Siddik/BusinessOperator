/**
 * UI helpers for integration states (client-safe). A country in the list is not
 * an integration — these states say exactly what is and isn't connected.
 */
export type UiIntegrationState = "CONNECTED" | "NOT_SYNCED" | "LOOKUP_ONLY" | "NEEDS_CREDENTIALS" | "NEEDS_APPROVAL" | "UNDER_RESEARCH" | "PROVIDER_ERROR" | "NO_VERIFIED_FEED";

export const STATE_LABELS: Record<UiIntegrationState, string> = {
  CONNECTED: "Connected",
  NOT_SYNCED: "Connected · not synced yet",
  LOOKUP_ONLY: "Lookup only",
  NEEDS_CREDENTIALS: "Needs credentials",
  NEEDS_APPROVAL: "Needs approval",
  UNDER_RESEARCH: "Under research",
  PROVIDER_ERROR: "Provider error",
  NO_VERIFIED_FEED: "No verified feed found",
};

/** States in which no daily registration feed runs. */
export function hasNoFeed(state: string) {
  return ["LOOKUP_ONLY", "NEEDS_CREDENTIALS", "NEEDS_APPROVAL", "UNDER_RESEARCH", "NO_VERIFIED_FEED"].includes(state);
}

export function needsAccess(state: string) {
  return state === "NEEDS_CREDENTIALS" || state === "NEEDS_APPROVAL";
}

/* ───────────── Country status + priority (sidebar / overview ordering) ───────────── */

/**
 * User-facing country status:
 *  LIVE       — real registrations have been synchronized (records exist and a sync succeeded)
 *  NOT_SYNCED — a working source is connected but has delivered no registrations yet
 *  ERROR      — a connected source failed and no registrations are stored
 *  READY      — an adapter exists; the Owner must add free credentials / an agreement
 *  PAID       — an adapter exists but the only source is a paid commercial service
 *  PARTIAL    — some data (lookup) but no daily registration feed
 *  NA         — no verified automated source
 */
export type CountryStatus = "LIVE" | "NOT_SYNCED" | "ERROR" | "READY" | "PAID" | "PARTIAL" | "NA";

export const COUNTRY_STATUS_LABELS: Record<CountryStatus, string> = {
  LIVE: "LIVE",
  NOT_SYNCED: "Not synced",
  ERROR: "Error",
  READY: "READY",
  PAID: "PAID",
  PARTIAL: "PARTIAL",
  NA: "N/A",
};

export const COUNTRY_STATUS_MEANINGS: Record<CountryStatus, string> = {
  LIVE: "Real registration data is synchronized",
  NOT_SYNCED: "Source connected — no registrations synchronized yet",
  ERROR: "Source connected but the last sync failed — no data stored",
  READY: "Integration built — needs your credentials / approval",
  PAID: "Integration built — the source is a paid commercial service",
  PARTIAL: "Partial — lookup only, no daily registration feed",
  NA: "No verified automated source",
};

/** Registrations of the recent window (from daily snapshots) used for ranking. */
export type CountryCoverage = { days: number; total: number; withEmail: number; withPhone: number; withWebsite: number; withPerson: number; withDirect: number };

export type CountryRankInput = {
  name: string;
  state: string;
  /** Real adapter with a daily feed (not a catalogue placeholder). */
  adapterReady: boolean;
  /** The adapter's access is a paid commercial service. */
  paid?: boolean;
  lastSuccessAt?: Date | string | null;
  coverage?: CountryCoverage | null;
};

/** "Meaningful" contact coverage: at least 5 contactable companies and 5 % of recent registrations. */
export function hasUsefulContactCoverage(c: CountryCoverage | null | undefined) {
  return !!c && c.total > 0 && c.withDirect >= 5 && c.withDirect / c.total >= 0.05;
}

export function countryStatus(x: CountryRankInput): CountryStatus {
  const hasData = (x.coverage?.total ?? 0) > 0 && !!x.lastSuccessAt;
  if (hasData) return "LIVE";
  switch (x.state) {
    case "CONNECTED":
    case "NOT_SYNCED":
      return "NOT_SYNCED";
    case "PROVIDER_ERROR":
      return "ERROR";
    case "NEEDS_CREDENTIALS":
    case "NEEDS_APPROVAL":
      return x.adapterReady ? (x.paid ? "PAID" : "READY") : "NA";
    case "LOOKUP_ONLY":
      return "PARTIAL";
    default:
      return "NA";
  }
}

/**
 * Priority tier (lower = higher in the list), computed from source health and stored data:
 *  1 live + useful contact coverage · 2 live · 3 connected, no data yet · 4 ready / paid ·
 *  5 partial · 6 not available.
 */
export function countryTier(x: CountryRankInput): number {
  const s = countryStatus(x);
  if (s === "LIVE") return hasUsefulContactCoverage(x.coverage) ? 1 : 2;
  if (s === "NOT_SYNCED" || s === "ERROR") return 3;
  if (s === "READY" || s === "PAID") return 4;
  if (s === "PARTIAL") return 5;
  return 6;
}

const dayKey = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");

/**
 * Order: tier → recent registrations available → latest successful sync (by day, so
 * minute-level sync jitter does not reshuffle the list) → contact coverage → name.
 * READY sorts before PAID inside tier 4.
 */
export function compareCountries(a: CountryRankInput, b: CountryRankInput) {
  const ta = countryTier(a);
  const tb = countryTier(b);
  if (ta !== tb) return ta - tb;
  const da = (a.coverage?.total ?? 0) > 0 ? 1 : 0;
  const db = (b.coverage?.total ?? 0) > 0 ? 1 : 0;
  if (da !== db) return db - da;
  const sa = dayKey(a.lastSuccessAt);
  const sb = dayKey(b.lastSuccessAt);
  if (sa !== sb) return sb.localeCompare(sa);
  const ra = a.coverage?.total ? a.coverage.withDirect / a.coverage.total : 0;
  const rb = b.coverage?.total ? b.coverage.withDirect / b.coverage.total : 0;
  if (ra !== rb) return rb - ra;
  const pa = countryStatus(a) === "PAID" ? 1 : 0;
  const pb = countryStatus(b) === "PAID" ? 1 : 0;
  if (pa !== pb) return pa - pb;
  return a.name.localeCompare(b.name);
}

export function sortCountries<T extends CountryRankInput>(items: T[]): T[] {
  return [...items].sort(compareCountries);
}

/**
 * Sidebar meta for one country: today's count for LIVE countries (or "LIVE" when today
 * has no snapshot yet), otherwise the plain status. The title carries the detail.
 */
export function countryNavMeta(x: CountryRankInput & { today: number | null; detail?: string }): { meta: string; title: string; status: CountryStatus } {
  const status = countryStatus(x);
  const c = x.coverage;
  if (status === "LIVE" && c) {
    const parts = [
      x.today === null ? "Today not synced yet" : `${x.today} registered today`,
      `${c.total} new companies in ${c.days} days`,
      `${c.withEmail} with email`,
      `${c.withPhone} with phone`,
      `${c.withWebsite} with website`,
    ];
    return { status, meta: x.today === null ? "LIVE" : String(x.today), title: `LIVE — ${parts.join(" · ")}` };
  }
  const detail = x.detail ? ` — ${x.detail}` : "";
  return { status, meta: COUNTRY_STATUS_LABELS[status], title: `${COUNTRY_STATUS_MEANINGS[status]}${status === "READY" || status === "PAID" || status === "ERROR" ? detail : ""}` };
}
