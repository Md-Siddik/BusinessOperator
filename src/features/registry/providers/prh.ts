import "server-only";
import { toDay, type Day } from "@/lib/dates/country-time";
import { createHttpClient } from "../http";
import { clean, cleanWebsite, joinStreet, titleCase } from "../normalize-helpers";
import type { CompanyRegistryProvider, FetchContext, NormalizedAddress, NormalizedCompany, ProviderStatus } from "../types";

/**
 * FINLAND — Finnish Patent and Registration Office (PRH), YTJ open data API v3.
 * Official, public, no API key. Docs: https://avoindata.prh.fi/en/ytj/swagger-ui
 *
 * Daily view: GET /companies?registrationDateStart=D&registrationDateEnd=D&page=N (100 per page, 1-based)
 * The open data does not include email or phone numbers; website is included when registered.
 */
const BASE = (process.env.FINLAND_PRH_API_URL || "https://avoindata.prh.fi/opendata-ytj-api/v3").replace(/\/$/, "");
const http = createHttpClient({ name: "PRH (YTJ open data)", minIntervalMs: 400, timeoutMs: 30_000 });

type Desc = { languageCode: string; description: string };
type PrhAddress = { type: number; street?: string; postCode?: string; postOffices?: { city: string; languageCode: string }[]; buildingNumber?: string; entrance?: string; apartmentNumber?: string; postOfficeBox?: string; co?: string };
export type PrhCompany = {
  businessId: { value: string; registrationDate?: string };
  names?: { name: string; type: string; registrationDate?: string; endDate?: string; version?: number }[];
  companyForms?: { type: string; descriptions?: Desc[]; endDate?: string }[];
  companySituations?: { type: string; descriptions?: Desc[]; endDate?: string }[];
  registeredEntries?: { type: string; descriptions?: Desc[]; endDate?: string; register?: string }[];
  mainBusinessLine?: { type: string; descriptions?: Desc[]; typeCodeSet?: string };
  website?: { url?: string };
  addresses?: PrhAddress[];
  registrationDate?: string;
  lastModified?: string;
};

const en = (d?: Desc[]) => d?.find((x) => x.languageCode === "3")?.description ?? d?.find((x) => x.languageCode === "1")?.description;

function address(a: PrhAddress | undefined): NormalizedAddress | undefined {
  if (!a) return undefined;
  const street = joinStreet([a.street, a.buildingNumber, a.entrance, a.apartmentNumber]) ?? (a.postOfficeBox ? `PO Box ${a.postOfficeBox}` : undefined);
  const city = a.postOffices?.find((p) => p.languageCode === "1")?.city ?? a.postOffices?.[0]?.city;
  return { street: [clean(a.co), street].filter(Boolean).join(", ") || undefined, postalCode: clean(a.postCode), city: titleCase(clean(city)), country: "Finland" };
}

export function sourceUrlFor(businessId: string) {
  return `https://tietopalvelu.ytj.fi/yritys/${businessId}`;
}

/** TOL 2008 is the Finnish version of NACE Rev. 2: the first four digits are the NACE class. */
function naceFromTol(code: string | undefined) {
  return code && /^\d{4,5}$/.test(code) ? `${code.slice(0, 2)}.${code.slice(2, 4)}` : undefined;
}

export function normalizePrhCompany(c: PrhCompany): NormalizedCompany {
  const currentName = c.names?.find((n) => !n.endDate && n.type === "1") ?? c.names?.find((n) => !n.endDate) ?? c.names?.[0];
  const form = c.companyForms?.find((f) => !f.endDate) ?? c.companyForms?.[0];
  const situation = c.companySituations?.find((s) => !s.endDate);
  const entry = c.registeredEntries?.find((e) => !e.endDate && e.register === "1") ?? c.registeredEntries?.find((e) => !e.endDate);
  const visiting = c.addresses?.find((a) => a.type === 1);
  const postal = c.addresses?.find((a) => a.type === 2);
  const line = c.mainBusinessLine;
  return {
    identity: { sourceId: c.businessId.value, name: currentName?.name ?? c.businessId.value, registrationNumber: c.businessId.value },
    registration: {
      registrationDay: toDay(c.registrationDate),
      status: en(situation?.descriptions) ?? en(entry?.descriptions),
      legalForm: en(form?.descriptions),
      legalFormCode: form?.type,
    },
    classification: {
      industryCode: line?.type,
      industryDescription: en(line?.descriptions),
      codeSystem: line ? "TOL 2008 (NACE Rev. 2)" : undefined,
      naceCode: naceFromTol(line?.type),
      businessActivity: en(line?.descriptions),
    },
    contact: { website: cleanWebsite(c.website?.url) },
    address: { business: address(visiting) ?? address(postal), postal: visiting ? address(postal) : undefined },
    source: { url: sourceUrlFor(c.businessId.value), updatedAt: c.lastModified ? new Date(`${c.lastModified}Z`) : undefined, raw: c },
  };
}

export function createPrhProvider(): CompanyRegistryProvider {
  return {
    id: "prh",
    countryCode: "FI",
    name: "PRH — YTJ open data (v3)",
    sourceName: "Finnish Patent and Registration Office (PRH)",
    sourceType: "OFFICIAL_OPEN_DATA",
    freshness: "DAILY",
    isDemo: false,
    accessType: "OPEN",
    registrationDateType: "Trade register registration date",
    homepage: "https://avoindata.prh.fi",
    docsUrl: "https://avoindata.prh.fi/en/ytj/swagger-ui",
    description: "Official Finnish business register open data (YTJ). No API key required.",
    limitations: "The open data does not include email addresses or phone numbers. Use “Find contact details” to look on the company website.",
    capabilities: {
      supportsDailyRegistrations: true,
      supportsRealTimeSearch: false,
      supportsDailyUpdates: true,
      supportsRegistrationDate: true,
      supportsLookup: true,
      supportsEmail: false,
      supportsPhone: false,
      supportsMobile: false,
      supportsWebsite: true,
      supportsAddress: true,
      supportsIndustry: true,
      supportsDirectors: false,
      supportsRoles: false,
      supportsSourceUrl: true,
    },
    requiredEnv: [],
    isConfigured: () => true,
    recommendedSyncMinutes: 6 * 60,

    async getRegistrations(from: Day, to: Day, ctx: FetchContext) {
      const companies: NormalizedCompany[] = [];
      let total: number | undefined;
      for (let page = 1; companies.length < ctx.limit && page <= 200; page++) {
        const data = await http.json<{ totalResults?: number; companies?: PrhCompany[] }>(`${BASE}/companies?registrationDateStart=${from}&registrationDateEnd=${to}&page=${page}`, { signal: ctx.signal });
        total = data.totalResults ?? total;
        const items = data.companies ?? [];
        companies.push(...items.map(normalizePrhCompany));
        ctx.log?.(`Fetched page ${page} (${companies.length}/${total ?? "?"})`);
        if (!items.length || (total !== undefined && companies.length >= total)) break;
      }
      const capped = companies.slice(0, ctx.limit);
      return { companies: capped, total, complete: total === undefined || capped.length >= total };
    },

    async getCompany(businessId, ctx) {
      const data = await http.json<{ companies?: PrhCompany[] }>(`${BASE}/companies?businessId=${encodeURIComponent(businessId)}`, { signal: ctx?.signal });
      const c = data.companies?.[0];
      return c ? normalizePrhCompany(c) : null;
    },

    async searchCompanies(q, ctx) {
      const params = new URLSearchParams();
      if (q.registrationNumber) params.set("businessId", q.registrationNumber);
      if (q.name) params.set("name", q.name);
      const data = await http.json<{ companies?: PrhCompany[] }>(`${BASE}/companies?${params}`, { signal: ctx?.signal });
      return (data.companies ?? []).slice(0, 20).map(normalizePrhCompany);
    },

    async checkStatus(): Promise<ProviderStatus> {
      try {
        await http.json(`${BASE}/companies?businessId=0112038-9`);
        return { state: "CONNECTED", checkedAt: new Date() };
      } catch (e) {
        return { state: "UNAVAILABLE", message: e instanceof Error ? e.message : String(e), checkedAt: new Date() };
      }
    },
  };
}
