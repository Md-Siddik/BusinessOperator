import "server-only";
import { addDays, isDay, todayIn, type Day } from "@/lib/dates/country-time";
import { cachedRows, csvObjects, lines, unzipSingleEntry } from "../bulk-file";
import { createHttpClient } from "../http";
import { clean } from "../normalize-helpers";
import type { CompanyRegistryProvider, FetchContext, NormalizedCompany, ProviderStatus } from "../types";

/**
 * ESTONIA — e-Business Register (RIK) open data, "Basic data" file
 * (ettevotja_rekvisiidid__lihtandmed.csv.zip). Official, CC BY 4.0, updated once a day,
 * downloadable without an account. Docs: https://avaandmed.ariregister.rik.ee/en/downloading-open-data
 *
 * Registration date = ettevotja_esmakande_kpv ("date of first entry", dd.mm.yyyy).
 * The file covers entities currently in the register (entered / in liquidation / bankrupt).
 * The contract-based XML services stay available as the separate "rik" provider.
 */
const FILE_URL = (process.env.ESTONIA_RIK_OPEN_DATA_URL || "https://avaandmed.ariregister.rik.ee/sites/default/files/avaandmed/ettevotja_rekvisiidid__lihtandmed.csv.zip").trim();
const http = createHttpClient({ name: "RIK open data", minIntervalMs: 1000, timeoutMs: 5 * 60_000, maxRetries: 2 });
const KEEP_DAYS = 400;
/** Sole traders (FIE) are natural persons; excluded unless explicitly enabled (as for France). */
const includeSoleTraders = () => process.env.ESTONIA_INCLUDE_SOLE_TRADERS === "true";

export type RikRow = {
  code: string;
  name: string;
  legalForm: string;
  legalFormSub: string;
  status: string;
  statusText: string;
  day: Day;
  street: string;
  area: string;
  postalCode: string;
  link: string;
};

/** "dd.mm.yyyy" → "yyyy-mm-dd" */
export function rikDay(v: string | undefined): Day | undefined {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v?.trim() ?? "");
  const d = m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
  return d && isDay(d) ? d : undefined;
}

/** "Pirita linnaosa, Tallinn, Harju maakond" → city "Tallinn", region "Harju maakond". */
export function parseEhak(text: string): { city?: string; region?: string } {
  const parts = text.split(",").map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return {};
  const region = parts.length > 1 && /maakond$/.test(parts[parts.length - 1]!) ? parts[parts.length - 1] : undefined;
  const local = region ? parts.slice(0, -1) : parts;
  const city = (local.length > 1 ? local[local.length - 1] : local[0])?.replace(/\s+linn$/, "");
  return { city, region };
}

const isSoleTrader = (form: string) => /füüsilisest isikust ettevõtja/i.test(form);

export function normalizeRikRow(r: RikRow): NormalizedCompany {
  const { city, region } = parseEhak(r.area);
  return {
    identity: { sourceId: r.code, name: clean(r.name) ?? r.code, registrationNumber: r.code },
    registration: { registrationDay: r.day, status: clean(r.statusText), legalForm: clean(r.legalForm), legalFormCode: clean(r.legalFormSub) || undefined },
    classification: {},
    contact: {},
    address: { business: { street: clean(r.street), postalCode: clean(r.postalCode), city: clean(city), region: clean(region), country: "Estonia" } },
    eventType: /filiaal/i.test(r.legalForm) ? "BRANCH" : "NEW_ENTITY",
    source: { url: /^https:\/\/ariregister\.rik\.ee\//.test(r.link) ? r.link : `https://ariregister.rik.ee/eng/company/${r.code}`, raw: r },
  };
}

export async function parseRikBasic(zip: Buffer, since: string): Promise<RikRow[]> {
  const { stream } = unzipSingleEntry(zip, (n) => n.endsWith(".csv"));
  const rows: RikRow[] = [];
  const soleTraders = includeSoleTraders();
  for await (const o of csvObjects(lines(stream), ";")) {
    const day = rikDay(o.ettevotja_esmakande_kpv);
    if (!o.ariregistri_kood || !day || day < since) continue;
    const legalForm = o.ettevotja_oiguslik_vorm ?? "";
    if (!soleTraders && isSoleTrader(legalForm)) continue;
    rows.push({
      code: o.ariregistri_kood,
      name: o.nimi ?? "",
      legalForm,
      legalFormSub: o.ettevotja_oigusliku_vormi_alaliik ?? "",
      status: o.ettevotja_staatus ?? "",
      statusText: o.ettevotja_staatus_tekstina ?? "",
      day,
      street: o.asukoht_ettevotja_aadressis ?? "",
      area: o.asukoha_ehak_tekstina ?? "",
      postalCode: o.indeks_ettevotja_aadressis ?? "",
      link: o.teabesysteemi_link ?? "",
    });
  }
  return rows;
}

async function recentRows(from: Day, signal?: AbortSignal) {
  const keepFrom = addDays(todayIn("Europe/Tallinn"), -KEEP_DAYS);
  const since = from < keepFrom ? from : keepFrom;
  return cachedRows<RikRow>(`rik-open-data|${includeSoleTraders()}`, { http, url: FILE_URL, since, signal, parse: async (res, s) => parseRikBasic(Buffer.from(await res.arrayBuffer()), s) });
}

export function createRikOpenDataProvider(): CompanyRegistryProvider {
  return {
    id: "rik-open-data",
    countryCode: "EE",
    name: "RIK e-Business Register — open data (basic data file)",
    sourceName: "Estonian e-Business Register (RIK)",
    sourceType: "OFFICIAL_OPEN_DATA",
    freshness: "DAILY",
    isDemo: false,
    accessType: "OPEN",
    registrationDateType: "Date of first entry in the register (ettevotja_esmakande_kpv)",
    homepage: "https://ariregister.rik.ee",
    docsUrl: "https://avaandmed.ariregister.rik.ee/en/downloading-open-data",
    description: "Official Estonian business register open data (CC BY 4.0). Daily file, no account or API key.",
    limitations: "The basic data file has no industry, email, phone or website. Sole traders (FIE) are excluded by default. Use “Find contact details” to research contacts.",
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
    recommendedSyncMinutes: 6 * 60,

    async getRegistrations(from: Day, to: Day, ctx: FetchContext) {
      if (!isDay(from) || !isDay(to)) throw new Error("Invalid date");
      const { rows } = await recentRows(from, ctx.signal);
      const matching = rows.filter((r) => r.day >= from && r.day <= to);
      ctx.log?.(`Found ${matching.length} registrations in the daily open-data file`);
      const companies = matching.slice(0, ctx.limit).map(normalizeRikRow);
      return { companies, total: matching.length, complete: companies.length >= matching.length };
    },

    async getLatestPublication() {
      const res = await http.request(FILE_URL, { method: "HEAD", headers: { Accept: "*/*" } });
      const lm = res.headers.get("last-modified");
      return lm ? new Date(lm) : null;
    },

    async checkStatus(): Promise<ProviderStatus> {
      try {
        const res = await http.request(FILE_URL, { method: "HEAD", headers: { Accept: "*/*" } });
        if (!res.ok) throw new Error(`RIK open data responded ${res.status}`);
        return { state: "CONNECTED", checkedAt: new Date() };
      } catch (e) {
        return { state: "UNAVAILABLE", message: e instanceof Error ? e.message : String(e), checkedAt: new Date() };
      }
    },
  };
}
