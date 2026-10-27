import "server-only";
import { COUNTRIES, getCountry } from "@/config/countries";
import { SystemSetting } from "@/models";
import { classifyCompany, isInactiveStatus } from "@/lib/company-classification";
import { addDays, todayIn, type Day } from "@/lib/dates/country-time";
import { getRegistryProvider } from "./providers";
import type { CompanyRegistryProvider, NormalizedCompany } from "./types";

/**
 * Established-company collection. The daily feeds only bring in companies registered today; this
 * job adds existing, operating companies by asking the same official sources for companies
 * registered on past days, walking backwards from five years ago one day at a time.
 *
 *  - Only adapters whose official API answers a historical registration-date window directly
 *    (no full-register download) take part; bulk-file sources (Latvia, Estonia, Canada) need a
 *    windowed streaming scan first and are reported as "not yet collected".
 *  - Only records the source lists as active are stored, and only those the shared rules
 *    classify as Established Company or Needs Review (never relabelled as startups).
 *  - Records are upserted by registry id like every sync (no duplicates) and tagged
 *    discoveredVia = ESTABLISHED_COLLECTION; contact research is queued as for new companies.
 *  - Bounded: a few days per country per run, a record cap per day, once a day per country.
 */

/** Adapters verified to answer historical registration-date windows with a direct query. */
export const ESTABLISHED_PROVIDERS = ["brreg", "prh", "cro", "us-state-open-data", "asic-au", "companies-house", "insee-sirene"] as const;
const NOT_COLLECTED: Record<string, string> = {
  "ur-lv": "Bulk register file — needs a windowed streaming scan before historical days can be read without loading the whole register.",
  "rik-open-data": "Bulk register file — needs a windowed streaming scan before historical days can be read without loading the whole register.",
  "corporations-canada": "Bulk register file — needs a windowed streaming scan before historical days can be read without loading the whole register.",
  "krs-pl": "The KRS bulletin is scanned entry by entry (about 10 minutes per day) — too slow for historical collection.",
  bodacc: "Publication-based feed: historical publications are announcements, not a register of operating companies.",
  shab: "Publication-based feed: historical publications are announcements, not a register of operating companies.",
  "ares-cz": "Publication-based feed: historical publications are announcements, not a register of operating companies.",
};

const SETTING_KEY = "established.collection";
const START_YEARS_BACK = 5;
/** Walk back at most this far (older companies are still found through later runs' wrap-around). */
const MAX_YEARS_BACK = 30;

type CountryState = { cursor?: Day; lastRunAt?: string; collected?: number; lastError?: string; lastResult?: string };
type State = Record<string, CountryState>;

async function readState(): Promise<State> {
  const doc = await SystemSetting.findOne({ key: SETTING_KEY }).lean<{ value?: State }>();
  return doc?.value ?? {};
}

async function writeCountryState(code: string, s: CountryState) {
  await SystemSetting.updateOne({ key: SETTING_KEY }, { $set: { [`value.${code}`]: s } }, { upsert: true });
}

/** Keep only active, non-startup records (established or needs review by the shared rules). */
export function selectEstablished(records: NormalizedCompany[], now = new Date()) {
  return records.filter((n) => {
    if (isInactiveStatus(n.registration.status)) return false;
    const c = classifyCompany({ incorporationDate: n.registration.incorporationDay, registrationDay: n.registration.registrationDay, eventType: n.eventType ?? "NEW_ENTITY", status: n.registration.status, employees: n.employees }, now);
    return c.value !== "STARTUP";
  });
}

export function establishedProviderFor(countryCode: string): { provider?: CompanyRegistryProvider; reason?: string } {
  const def = getCountry(countryCode);
  const provider = def ? getRegistryProvider(def.defaultProviderId) : undefined;
  if (!provider || provider.isDemo || !provider.getRegistrations) return { reason: "No registry adapter with a registration feed." };
  if (!(ESTABLISHED_PROVIDERS as readonly string[]).includes(provider.id)) return { provider, reason: NOT_COLLECTED[provider.id] ?? "This adapter is not verified for historical registration windows." };
  if (!provider.isConfigured()) return { provider, reason: `Needs credentials: ${provider.requiredEnv.join(", ")}.` };
  return { provider };
}

/** Coverage of the established collection per country (for the coverage report and the UI). */
export async function establishedCoverage() {
  const state = await readState();
  return COUNTRIES.map((c) => {
    const { provider, reason } = establishedProviderFor(c.code);
    return { code: c.code, name: c.name, provider: provider?.id, collecting: !reason, reason, ...state[c.code] };
  });
}

export type EstablishedRunResult = { country: string; days: Day[]; fetched: number; kept: number; imported: number; updated: number; skippedReason?: string; error?: string };

/**
 * Collect established companies for one country: `days` historical registration days, at most
 * `perDay` records each. Resumes from the stored cursor; never runs twice within `minHours`.
 */
export async function collectEstablishedCountry(code: string, opts: { days?: number; perDay?: number; minHours?: number; log?: (m: string) => void; now?: Date } = {}): Promise<EstablishedRunResult> {
  const now = opts.now ?? new Date();
  const def = getCountry(code);
  const result: EstablishedRunResult = { country: code, days: [], fetched: 0, kept: 0, imported: 0, updated: 0 };
  if (!def) return { ...result, skippedReason: "Unknown country" };
  const { provider, reason } = establishedProviderFor(code);
  if (!provider || reason) return { ...result, skippedReason: reason };
  const state = (await readState())[code] ?? {};
  const minHours = opts.minHours ?? 20;
  if (state.lastRunAt && now.getTime() - new Date(state.lastRunAt).getTime() < minHours * 3_600_000) return { ...result, skippedReason: "Ran recently" };

  const today = todayIn(def.timezone);
  const newest = addDays(today, -Math.round(START_YEARS_BACK * 365.25));
  const oldest = addDays(today, -Math.round(MAX_YEARS_BACK * 365.25));
  let cursor = state.cursor && state.cursor <= newest && state.cursor >= oldest ? state.cursor : newest;
  const { ingestCompanies } = await import("./sync");
  let collected = state.collected ?? 0;
  try {
    for (let i = 0; i < (opts.days ?? 2); i++) {
      const day = cursor;
      const batch = await provider.getRegistrations!(day, day, { limit: opts.perDay ?? 150, signal: AbortSignal.timeout(120_000), log: opts.log });
      const kept = selectEstablished(batch.companies, now);
      result.days.push(day);
      result.fetched += batch.companies.length;
      result.kept += kept.length;
      if (kept.length) {
        const r = await ingestCompanies(provider, code, kept, { discoveredVia: "ESTABLISHED_COLLECTION" });
        result.imported += r.imported;
        result.updated += r.updated;
        collected += r.imported;
      }
      opts.log?.(`${code} ${day}: ${batch.companies.length} fetched, ${kept.length} active & established, ${result.imported} new so far`);
      cursor = addDays(day, -1);
      if (cursor < oldest) cursor = newest; // wrap around: start again from the most recent established days
    }
    await writeCountryState(code, { cursor, lastRunAt: now.toISOString(), collected, lastResult: `${result.kept} kept / ${result.fetched} fetched on ${result.days.join(", ")}` });
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    // Keep the cursor so the failed day is retried next run.
    await writeCountryState(code, { ...state, cursor, lastRunAt: now.toISOString(), collected, lastError: result.error });
  }
  return result;
}

/** Scheduler entry: every enabled country with a verified adapter, sequentially. */
export async function collectEstablished(opts: { countries?: string[]; days?: number; perDay?: number; minHours?: number; log?: (m: string) => void } = {}) {
  const { getEnabledCountries } = await import("@/features/countries/service");
  const enabled = (await getEnabledCountries()).map((c) => c.code);
  const targets = (opts.countries?.length ? opts.countries : enabled).map((c) => c.toUpperCase());
  const out: EstablishedRunResult[] = [];
  for (const code of targets) out.push(await collectEstablishedCountry(code, opts));
  return out;
}
