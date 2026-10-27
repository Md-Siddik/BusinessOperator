import "server-only";
import { eachDay, isDay, type Day } from "@/lib/dates/country-time";
import { createHttpClient } from "../http";
import { clean } from "../normalize-helpers";
import type { CompanyRegistryProvider, FetchContext, NormalizedCompany, ProviderStatus } from "../types";

/**
 * AUSTRALIA — ASIC "Company Dataset" on data.gov.au (CC BY 3.0 AU), queried through the CKAN
 * DataStore with an exact filter on "Date of Registration" (dd/mm/yyyy). No key.
 * Dataset: https://data.gov.au/data/dataset/asic-companies
 *
 * Verified 26–27 Oct 2026: the "Company Dataset - Current" resource is refreshed daily and holds
 * registrations up to the previous Sydney day. ASIC publishes a new monthly resource, so the
 * current resource id is resolved from the dataset on every run. One row per company name;
 * only current names (Current Name Indicator "Y") are imported. No address or contact fields.
 */
const BASE = (process.env.AUSTRALIA_DATA_GOV_API || "https://data.gov.au/data/api/3/action").replace(/\/$/, "");
const PACKAGE = "asic-companies";
const PAGE = 1000;
const http = createHttpClient({ name: "ASIC company dataset (data.gov.au)", minIntervalMs: 1000, timeoutMs: 120_000 });

export type AsicRecord = Record<string, string | null | undefined>;

const TYPES: Record<string, string> = { APTY: "Australian proprietary company", APUB: "Australian public company", FNOS: "Foreign company (registered in Australia)", RACN: "Registered Australian body", ASSN: "Association" };
const STATUSES: Record<string, string> = { REGD: "Registered", DRGD: "Deregistered", EXAD: "External administration", SOFF: "Strike-off action in progress" };

/** "23/10/2026" ⇄ "2026-10-23". */
export const asicDate = (day: Day) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
export function asicDay(v: unknown): Day | undefined {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v ?? "").trim());
  const d = m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
  return d && isDay(d) ? d : undefined;
}

export function normalizeAsicRecord(r: AsicRecord): NormalizedCompany | null {
  const acn = clean(r.ACN);
  const name = clean(r["Company Name"]);
  const day = asicDay(r["Date of Registration"]);
  if (!acn || !name || !day || (r["Current Name Indicator"] ?? "").trim() !== "Y") return null;
  const type = clean(r.Type);
  const abn = clean(r.ABN);
  return {
    identity: { sourceId: acn, name, registrationNumber: acn },
    registration: { registrationDay: day, legalForm: type ? (TYPES[type] ?? type) : undefined, status: STATUSES[clean(r.Status) ?? ""] ?? clean(r.Status) },
    classification: {},
    contact: {},
    address: { business: { country: "Australia" } },
    eventType: type === "FNOS" ? "BRANCH" : "NEW_ENTITY",
    source: { url: "https://data.gov.au/data/dataset/asic-companies", raw: { ...r, ABN: abn && abn !== "0" ? abn : undefined } },
  };
}

/** The DataStore resource of the current company file (ASIC rotates it monthly). */
export async function currentResource(signal?: AbortSignal) {
  const data = await http.json<{ result?: { resources?: { id: string; name?: string; format?: string; datastore_active?: boolean; last_modified?: string }[] } }>(`${BASE}/package_show?id=${PACKAGE}`, { signal });
  const res = (data.result?.resources ?? []).filter((r) => r.datastore_active && /csv/i.test(r.format ?? "") && /current/i.test(r.name ?? ""));
  const pick = res.sort((a, b) => (b.last_modified ?? "").localeCompare(a.last_modified ?? ""))[0];
  if (!pick) throw new Error("ASIC: no current company resource with a DataStore was found");
  return pick;
}

async function dayRecords(resourceId: string, day: Day, ctx: FetchContext) {
  const out: AsicRecord[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const qs = new URLSearchParams({ resource_id: resourceId, filters: JSON.stringify({ "Date of Registration": asicDate(day) }), limit: String(PAGE), offset: String(offset) });
    const data = await http.json<{ success: boolean; result?: { records: AsicRecord[]; total?: number } }>(`${BASE}/datastore_search?${qs}`, { signal: ctx.signal });
    if (!data.success) throw new Error("data.gov.au DataStore query failed");
    const rows = data.result?.records ?? [];
    out.push(...rows);
    if (rows.length < PAGE || out.length >= (data.result?.total ?? 0)) break;
  }
  return out;
}

export function createAsicAuProvider(): CompanyRegistryProvider {
  return {
    id: "asic-au",
    countryCode: "AU",
    name: "ASIC — Company Dataset (data.gov.au)",
    sourceName: "Australian Securities and Investments Commission (ASIC)",
    sourceType: "OFFICIAL_OPEN_DATA",
    freshness: "DAILY",
    isDemo: false,
    accessType: "OPEN",
    registrationDateType: "ASIC date of registration",
    homepage: "https://asic.gov.au",
    docsUrl: "https://data.gov.au/data/dataset/asic-companies",
    description: "Official register of Australian companies (ACN), refreshed daily on data.gov.au. No API key.",
    limitations: "Registrations appear the day after (Sydney time). The dataset has no address, industry, email, phone or website; the ABN is often not yet issued for brand-new companies.",
    capabilities: {
      supportsDailyRegistrations: true,
      supportsRealTimeSearch: false,
      supportsDailyUpdates: true,
      supportsRegistrationDate: true,
      supportsLookup: false,
      supportsEmail: false,
      supportsPhone: false,
      supportsMobile: false,
      supportsWebsite: false,
      supportsAddress: false,
      supportsIndustry: false,
      supportsDirectors: false,
      supportsRoles: false,
      supportsSourceUrl: true,
    },
    requiredEnv: [],
    isConfigured: () => true,
    recommendedSyncMinutes: 6 * 60,
    // Publishes with a lag: re-read the last 4 days so late filings are not missed.
    lookbackDays: 4,

    async getRegistrations(from: Day, to: Day, ctx: FetchContext) {
      if (!isDay(from) || !isDay(to)) throw new Error("Invalid date");
      const resource = await currentResource(ctx.signal);
      const byAcn = new Map<string, NormalizedCompany>();
      for (const day of eachDay(from, to)) {
        for (const r of await dayRecords(resource.id, day, ctx)) {
          const c = normalizeAsicRecord(r);
          if (c) byAcn.set(c.identity.sourceId, c);
        }
        ctx.log?.(`${day}: ${byAcn.size} companies so far`);
        if (byAcn.size >= ctx.limit) break;
      }
      const companies = [...byAcn.values()];
      return { companies: companies.slice(0, ctx.limit), total: companies.length, complete: companies.length <= ctx.limit };
    },

    async getLatestPublication() {
      const r = await currentResource();
      return r.last_modified ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(r.last_modified) ? r.last_modified : `${r.last_modified}Z`) : null;
    },

    async checkStatus(): Promise<ProviderStatus> {
      try {
        await currentResource();
        return { state: "CONNECTED", checkedAt: new Date() };
      } catch (e) {
        return { state: "UNAVAILABLE", message: e instanceof Error ? e.message : String(e), checkedAt: new Date() };
      }
    },
  };
}
