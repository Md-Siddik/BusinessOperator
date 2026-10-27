import "server-only";
import { addDays, isDay, todayIn, type Day } from "@/lib/dates/country-time";
import { bodyStream, cachedRows, csvObjects, lines } from "../bulk-file";
import { createHttpClient } from "../http";
import { clean, titleCase } from "../normalize-helpers";
import type { CompanyRegistryProvider, FetchContext, NormalizedCompany, ProviderStatus } from "../types";

/**
 * CANADA — Corporations Canada (ISED) "Federal Corporations" open data, Open Government
 * Licence – Canada. Dataset: https://open.canada.ca/data/en/dataset/0032ce54-c5dd-4b66-99a0-320a7b5e99f2
 *
 * The publisher regenerates "Active business corporations" (CBCA, ~100 MB CSV) daily
 * (frequency P1D; verified 26 Oct 2026, file modified 11:06 UTC). The file has no query API, so it
 * is streamed once per publication (Last-Modified) and only recent rows are kept in memory.
 *
 * Coverage: federally incorporated business corporations only. Most Canadian companies are
 * incorporated provincially (Ontario, Québec, BC …); those registers are not included.
 * Date: the CBCA "anniversary date" — the date of incorporation, amalgamation or continuance.
 * No industry, email, phone or website fields.
 */
const DATASET_API = "https://open.canada.ca/data/api/3/action/package_show?id=0032ce54-c5dd-4b66-99a0-320a7b5e99f2";
const FILE_URL = (process.env.CANADA_CBCA_ACTIVE_URL || "https://d4bf66bykfyaf.cloudfront.net/corporations-active-cbca-en.csv").trim();
const DATASET_PAGE = "https://open.canada.ca/data/en/dataset/0032ce54-c5dd-4b66-99a0-320a7b5e99f2";
const http = createHttpClient({ name: "Corporations Canada open data", minIntervalMs: 1000, timeoutMs: 10 * 60_000, maxRetries: 2 });
const KEEP_DAYS = 60;

export type CbcaRow = {
  number: string;
  bn?: string;
  name: string;
  nameFr?: string;
  legislation?: string;
  status?: string;
  day: Day;
  street?: string;
  city?: string;
  province?: string;
  country?: string;
  postalCode?: string;
};

const PROVINCES: Record<string, string> = { AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador", NS: "Nova Scotia", NT: "Northwest Territories", NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island", QC: "Québec", SK: "Saskatchewan", YT: "Yukon" };

export async function parseCbcaFile(chunks: AsyncIterable<Uint8Array>, since: Day): Promise<CbcaRow[]> {
  const out: CbcaRow[] = [];
  for await (const r of csvObjects(lines(chunks), ",")) {
    const day = (r["Anniversary date"] ?? "").trim();
    if (!isDay(day) || day < since) continue;
    const number = clean(r["Corporation number"]);
    const name = clean(r["Corporate name - form 1"]) ?? clean(r["Corporate name - form 2"]);
    if (!number || !name) continue;
    out.push({
      number,
      bn: clean(r["Business number (BN)"]),
      name,
      nameFr: clean(r["Corporate name - form 2"]),
      legislation: clean(r["Governing legislation"]),
      status: clean(r["Status"]),
      day,
      street: [clean(r["Street"]), clean(r["Street 2"])].filter(Boolean).join(", ") || undefined,
      city: clean(r["City/town"]),
      province: clean(r["Province/territory"]),
      country: clean(r["Country"]),
      postalCode: clean(r["Postal code"]),
    });
  }
  return out;
}

export function normalizeCbcaRow(r: CbcaRow): NormalizedCompany {
  const regNo = `FED-${r.number}`;
  return {
    identity: { sourceId: regNo, name: r.name, registrationNumber: regNo },
    registration: { registrationDay: r.day, status: r.status, legalForm: r.legislation === "Canada Business Corporations Act" ? "Federal corporation (CBCA)" : r.legislation },
    classification: {},
    contact: {},
    address: { business: { street: r.street, city: titleCase(r.city), postalCode: r.postalCode, region: r.province ? (PROVINCES[r.province] ?? r.province) : undefined, country: r.country === "CA" ? "Canada" : r.country } },
    source: { url: DATASET_PAGE, raw: r },
  };
}

async function recentRows(from: Day, signal?: AbortSignal) {
  const keepFrom = addDays(todayIn("America/Toronto"), -KEEP_DAYS);
  const since = from < keepFrom ? from : keepFrom;
  return cachedRows<CbcaRow>("cbca-ca", { http, url: FILE_URL, since, signal, parse: (res, s) => parseCbcaFile(bodyStream(res), s as Day) });
}

export function createCorporationsCanadaProvider(): CompanyRegistryProvider {
  return {
    id: "corporations-canada",
    countryCode: "CA",
    name: "Corporations Canada — Federal Corporations open data",
    sourceName: "Corporations Canada (ISED)",
    sourceType: "OFFICIAL_OPEN_DATA",
    freshness: "DAILY",
    isDemo: false,
    accessType: "OPEN",
    registrationDateType: "CBCA anniversary date — date of incorporation, amalgamation or continuance",
    homepage: "https://ised-isde.canada.ca/site/corporations-canada/en",
    docsUrl: DATASET_PAGE,
    description: "Official daily file of active federal business corporations (Open Government Licence – Canada). No API key.",
    limitations: "Federal (CBCA) corporations only — provincially incorporated companies are not included. The date can also be an amalgamation or continuance date. No industry, email, phone or website fields.",
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
      supportsAddress: true,
      supportsIndustry: false,
      supportsDirectors: false,
      supportsRoles: false,
      supportsSourceUrl: true,
    },
    requiredEnv: [],
    isConfigured: () => true,
    recommendedSyncMinutes: 12 * 60,
    // Publishes with a lag: re-read the last 3 days so late filings are not missed.
    lookbackDays: 3,

    async getRegistrations(from: Day, to: Day, ctx: FetchContext) {
      if (!isDay(from) || !isDay(to)) throw new Error("Invalid date");
      const { rows } = await recentRows(from, ctx.signal);
      const matching = rows.filter((r) => r.day >= from && r.day <= to);
      ctx.log?.(`Found ${matching.length} federal corporations in the daily file`);
      const companies = matching.slice(0, ctx.limit).map(normalizeCbcaRow);
      return { companies, total: matching.length, complete: companies.length >= matching.length };
    },

    async getLatestPublication() {
      const data = await http.json<{ result?: { resources?: { url?: string; last_modified?: string }[] } }>(DATASET_API);
      const mod = data.result?.resources?.find((r) => r.url === FILE_URL)?.last_modified;
      return mod ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(mod) ? mod : `${mod}Z`) : null;
    },

    async checkStatus(): Promise<ProviderStatus> {
      try {
        await http.json(DATASET_API);
        return { state: "CONNECTED", checkedAt: new Date() };
      } catch (e) {
        return { state: "UNAVAILABLE", message: e instanceof Error ? e.message : String(e), checkedAt: new Date() };
      }
    },
  };
}
