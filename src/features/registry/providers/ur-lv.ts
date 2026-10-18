import "server-only";
import { addDays, isDay, todayIn, type Day } from "@/lib/dates/country-time";
import { bodyStream, cachedRows, csvObjects, lines } from "../bulk-file";
import { createHttpClient } from "../http";
import { clean } from "../normalize-helpers";
import type { CompanyRegistryProvider, FetchContext, NormalizedAddress, NormalizedCompany, ProviderStatus } from "../types";

/**
 * LATVIA — Register of Enterprises (Uzņēmumu reģistrs, UR) open data on data.gov.lv.
 * Official High-Value Dataset (Implementing Regulation (EU) 2023/138), licence CC0 1.0,
 * regenerated daily. No API key. Dataset: https://data.gov.lv/dati/eng/dataset/uz
 *
 * register.csv (";"-separated, ~130 MB) lists every entity with its `registered` date.
 * The file has no query API, so it is streamed once per publication (ETag) and only
 * recent rows are kept in memory. No industry, email, phone or website fields.
 */
const DATASET_API = (process.env.LATVIA_UR_DATASET_API || "https://data.gov.lv/dati/api/3/action/package_show?id=uz").trim();
const FILE_URL = (process.env.LATVIA_UR_REGISTER_URL || "https://data.gov.lv/dati/dataset/4de9697f-850b-45ec-8bba-61fa09ce932f/resource/25e80bf3-f107-4ab4-89ef-251b5b9374e9/download/register.csv").trim();
const http = createHttpClient({ name: "UR open data (data.gov.lv)", minIntervalMs: 1000, timeoutMs: 10 * 60_000, maxRetries: 2 });
/** Keep at least this many days of registrations in memory between publications. */
const KEEP_DAYS = 400;

/**
 * Registers kept: K = Commercial Register (companies, sole merchants, branches),
 * U = Enterprise Register (farms, other undertakings). Associations and foundations (B),
 * mass media (M), political, religious and other registers are not business prospects.
 */
const BUSINESS_REGISTERS = new Set(["K", "U"]);

export type UrRow = {
  regcode: string;
  name: string;
  regtype: string;
  regtype_text: string;
  type: string;
  type_text: string;
  registered: string;
  terminated: string;
  address: string;
  index: string;
};

/** "Cēsu nov., Cēsis, Palejas iela 9" → region / city / street (municipality first, as UR publishes it). */
export function parseUrAddress(full: string, index?: string): NormalizedAddress | undefined {
  const parts = full.split(",").map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return undefined;
  const isArea = (x: string) => /\b(nov|pag)\.$/.test(x);
  const region = parts.find((x) => /\bnov\.$/.test(x));
  const cityIdx = parts.findIndex((x) => !isArea(x));
  const city = cityIdx >= 0 && cityIdx < parts.length - 1 ? parts[cityIdx] : undefined;
  const street = parts.slice(city ? cityIdx + 1 : parts.length - 1).join(", ") || undefined;
  return { street, postalCode: /^\d{4}$/.test(index ?? "") ? `LV-${index}` : undefined, city, region, country: "Latvia" };
}

export function normalizeUrRow(r: UrRow): NormalizedCompany {
  const branch = r.type === "AKF" || /filiāle/i.test(r.type_text);
  return {
    identity: { sourceId: r.regcode, name: clean(r.name) ?? r.regcode, registrationNumber: r.regcode },
    registration: {
      registrationDay: isDay(r.registered) ? r.registered : undefined,
      status: clean(r.terminated) ? "Terminated" : "Registered",
      legalForm: clean(r.type_text),
      legalFormCode: clean(r.type),
    },
    classification: {},
    contact: {},
    address: { business: parseUrAddress(r.address ?? "", clean(r.index)) },
    eventType: branch ? "BRANCH" : "NEW_ENTITY",
    source: { raw: r },
  };
}

/** Stream register.csv and keep business-register rows registered on or after `since`. */
export async function parseUrRegister(chunks: AsyncIterable<Uint8Array>, since: string): Promise<UrRow[]> {
  const rows: UrRow[] = [];
  for await (const o of csvObjects(lines(chunks), ";")) {
    if (!o.regcode || !isDay(o.registered) || o.registered < since) continue;
    if (!BUSINESS_REGISTERS.has(o.regtype ?? "")) continue;
    rows.push({ regcode: o.regcode, name: o.name ?? "", regtype: o.regtype ?? "", regtype_text: o.regtype_text ?? "", type: o.type ?? "", type_text: o.type_text ?? "", registered: o.registered, terminated: o.terminated ?? "", address: o.address ?? "", index: o.index ?? "" });
  }
  return rows;
}

async function recentRows(from: Day, signal?: AbortSignal) {
  const keepFrom = addDays(todayIn("Europe/Riga"), -KEEP_DAYS);
  const since = from < keepFrom ? from : keepFrom;
  return cachedRows<UrRow>("ur-lv", { http, url: FILE_URL, since, signal, parse: (res, s) => parseUrRegister(bodyStream(res), s) });
}

export function createUrLvProvider(): CompanyRegistryProvider {
  return {
    id: "ur-lv",
    countryCode: "LV",
    name: "Uzņēmumu reģistrs — open data (register.csv)",
    sourceName: "Register of Enterprises of Latvia (UR)",
    sourceType: "OFFICIAL_OPEN_DATA",
    freshness: "DAILY",
    isDemo: false,
    accessType: "OPEN",
    registrationDateType: "Date of registration in the register (registered)",
    homepage: "https://www.ur.gov.lv",
    docsUrl: "https://data.gov.lv/dati/eng/dataset/uz",
    description: "Official Latvian register open data (EU High-Value Dataset, CC0). Daily file, no API key.",
    limitations: "The open data has no industry code, email, phone or website. Associations, foundations and media are not imported. Use “Find contact details” to research contacts.",
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
      supportsSourceUrl: false,
    },
    requiredEnv: [],
    isConfigured: () => true,
    recommendedSyncMinutes: 6 * 60,

    async getRegistrations(from: Day, to: Day, ctx: FetchContext) {
      if (!isDay(from) || !isDay(to)) throw new Error("Invalid date");
      const { rows } = await recentRows(from, ctx.signal);
      const matching = rows.filter((r) => r.registered >= from && r.registered <= to);
      ctx.log?.(`Found ${matching.length} registrations in the daily register file`);
      const companies = matching.slice(0, ctx.limit).map(normalizeUrRow);
      return { companies, total: matching.length, complete: companies.length >= matching.length };
    },

    async getLatestPublication() {
      const data = await http.json<{ result?: { resources?: { url?: string; last_modified?: string }[] } }>(DATASET_API);
      const mod = data.result?.resources?.find((r) => r.url?.endsWith("/register.csv"))?.last_modified;
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
