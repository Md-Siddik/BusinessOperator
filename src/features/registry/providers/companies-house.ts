import "server-only";
import { toDay, type Day } from "@/lib/dates/country-time";
import { createHttpClient } from "../http";
import { clean, joinStreet, titleCase } from "../normalize-helpers";
import type { CompanyRegistryProvider, FetchContext, NormalizedCompany, NormalizedPerson, ProviderStatus } from "../types";

/**
 * UNITED KINGDOM — Companies House Public Data API (current register data).
 * Official. Requires a free API key: https://developer.company-information.service.gov.uk/
 * Auth: HTTP Basic with the API key as username and an empty password.
 * Rate limit: 600 requests per 5 minutes per key.
 *
 * Daily view: GET /advanced-search/companies?incorporated_from=D&incorporated_to=D&size=5000&start_index=N
 * Officers:   GET /company/{number}/officers
 * Companies House does not publish email addresses or phone numbers.
 */
const BASE = (process.env.UK_COMPANIES_HOUSE_API_URL || "https://api.company-information.service.gov.uk").replace(/\/$/, "");
const KEY = () => process.env.UK_COMPANIES_HOUSE_API_KEY || "";
const PAGE_SIZE = 5000;
const http = createHttpClient({ name: "Companies House", minIntervalMs: 550, timeoutMs: 30_000 });

const auth = () => ({ Authorization: `Basic ${Buffer.from(`${KEY()}:`).toString("base64")}` });

export type ChCompany = {
  company_name: string;
  company_number: string;
  company_status?: string;
  company_type?: string;
  date_of_creation?: string;
  registered_office_address?: { address_line_1?: string; address_line_2?: string; locality?: string; postal_code?: string; region?: string; country?: string; premises?: string };
  sic_codes?: string[];
};

const COMPANY_TYPES: Record<string, string> = {
  ltd: "Private limited company",
  plc: "Public limited company",
  llp: "Limited liability partnership",
  "private-unlimited": "Private unlimited company",
  "private-limited-guarant-nsc": "Private company limited by guarantee",
  "private-limited-guarant-nsc-limited-exemption": "Private company limited by guarantee (exempt)",
  "limited-partnership": "Limited partnership",
  "scottish-partnership": "Scottish partnership",
  "registered-society-non-jurisdictional": "Registered society",
  "charitable-incorporated-organisation": "Charitable incorporated organisation",
  "scottish-charitable-incorporated-organisation": "Scottish charitable incorporated organisation",
  "uk-establishment": "UK establishment of an overseas company",
};

export function sourceUrlFor(number: string) {
  return `https://find-and-update.company-information.service.gov.uk/company/${number}`;
}

export function normalizeChCompany(c: ChCompany): NormalizedCompany {
  const a = c.registered_office_address;
  const sic = c.sic_codes?.[0];
  return {
    identity: { sourceId: c.company_number, name: c.company_name, registrationNumber: c.company_number },
    registration: {
      registrationDay: toDay(c.date_of_creation),
      incorporationDay: toDay(c.date_of_creation),
      status: c.company_status ? c.company_status.charAt(0).toUpperCase() + c.company_status.slice(1).replace(/-/g, " ") : undefined,
      legalForm: c.company_type ? (COMPANY_TYPES[c.company_type] ?? c.company_type.replace(/-/g, " ")) : undefined,
      legalFormCode: c.company_type,
    },
    classification: {
      industryCode: c.sic_codes?.join(", "),
      codeSystem: sic ? "UK SIC 2007" : undefined,
      // UK SIC 2007 is derived from NACE Rev. 2: the first four digits are the NACE class.
      naceCode: sic && /^\d{5}$/.test(sic) ? `${sic.slice(0, 2)}.${sic.slice(2, 4)}` : undefined,
    },
    contact: {},
    address: {
      business: a
        ? { street: joinStreet([a.premises, a.address_line_1, a.address_line_2]), postalCode: clean(a.postal_code), city: titleCase(clean(a.locality)), region: clean(a.region), country: clean(a.country) }
        : undefined,
    },
    source: { url: sourceUrlFor(c.company_number), raw: c },
  };
}

function officerName(name: string) {
  // "SMITH, John Andrew" → "John Andrew Smith"
  const [last, first] = name.split(",").map((s) => s.trim());
  return first ? `${first} ${titleCase(last)}` : (titleCase(name) ?? name);
}

export function createCompaniesHouseProvider(): CompanyRegistryProvider {
  return {
    id: "companies-house",
    countryCode: "GB",
    name: "Companies House — Public Data API",
    sourceName: "Companies House",
    sourceType: "OFFICIAL_REGISTRY",
    freshness: "REAL_TIME",
    isDemo: false,
    accessType: "API_KEY",
    registrationDateType: "Incorporation date (date_of_creation)",
    homepage: "https://find-and-update.company-information.service.gov.uk",
    docsUrl: "https://developer-specs.company-information.service.gov.uk/companies-house-public-data-api/reference",
    description: "Official UK register — current registry data via the Public Data API (free API key).",
    limitations: "Companies House does not publish email addresses, phone numbers or websites.",
    capabilities: {
      supportsDailyRegistrations: true,
      supportsRealTimeSearch: true,
      supportsDailyUpdates: true,
      supportsRegistrationDate: true,
      supportsLookup: true,
      supportsEmail: false,
      supportsPhone: false,
      supportsMobile: false,
      supportsWebsite: false,
      supportsAddress: true,
      supportsIndustry: true,
      supportsDirectors: true,
      supportsRoles: true,
      supportsSourceUrl: true,
    },
    requiredEnv: ["UK_COMPANIES_HOUSE_API_KEY"],
    isConfigured: () => !!KEY(),
    recommendedSyncMinutes: 60,

    async getRegistrations(from: Day, to: Day, ctx: FetchContext) {
      const companies: NormalizedCompany[] = [];
      let total: number | undefined;
      for (let start = 0; companies.length < ctx.limit; start += PAGE_SIZE) {
        const url = `${BASE}/advanced-search/companies?incorporated_from=${from}&incorporated_to=${to}&size=${PAGE_SIZE}&start_index=${start}`;
        const res = await http.request(url, { headers: auth(), signal: ctx.signal });
        if (res.status === 404) break; // no results for the window
        if (!res.ok) {
          if (res.status === 401) throw new Error("Companies House rejected the API key (401). Check UK_COMPANIES_HOUSE_API_KEY.");
          throw new Error(`Companies House responded ${res.status}`);
        }
        const data = (await res.json()) as { items?: ChCompany[]; hits?: number };
        total = data.hits ?? total;
        const items = data.items ?? [];
        companies.push(...items.map(normalizeChCompany));
        ctx.log?.(`Fetched ${companies.length}/${total ?? "?"}`);
        if (items.length < PAGE_SIZE || (total !== undefined && companies.length >= total)) break;
      }
      const capped = companies.slice(0, ctx.limit);
      return { companies: capped, total, complete: total === undefined || capped.length >= total };
    },

    async getCompany(number, ctx) {
      const res = await http.request(`${BASE}/company/${encodeURIComponent(number)}`, { headers: auth(), signal: ctx?.signal });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Companies House responded ${res.status}`);
      return normalizeChCompany((await res.json()) as ChCompany);
    },

    async getPeople(number, ctx) {
      const res = await http.request(`${BASE}/company/${encodeURIComponent(number)}/officers?items_per_page=35`, { headers: auth(), signal: ctx?.signal });
      if (res.status === 404) return { people: [] };
      if (!res.ok) throw new Error(`Companies House officers responded ${res.status}`);
      const data = (await res.json()) as { items?: { name: string; officer_role?: string; resigned_on?: string }[] };
      const people: NormalizedPerson[] = (data.items ?? [])
        .filter((o) => !o.resigned_on)
        .map((o) => ({ name: officerName(o.name), role: (o.officer_role ?? "officer").replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase()), roleCode: o.officer_role, group: "Officers" }));
      return { people, contactPerson: people.find((p) => p.roleCode === "director") };
    },

    async checkStatus(): Promise<ProviderStatus> {
      if (!KEY()) return { state: "CREDENTIALS_REQUIRED", message: "Set UK_COMPANIES_HOUSE_API_KEY.", checkedAt: new Date() };
      try {
        const res = await http.request(`${BASE}/company/00000006`, { headers: auth() });
        await res.body?.cancel().catch(() => undefined);
        if (res.status === 401) return { state: "CREDENTIALS_REQUIRED", message: "The API key was rejected.", checkedAt: new Date() };
        return res.ok || res.status === 404 ? { state: "CONNECTED", checkedAt: new Date() } : { state: "UNAVAILABLE", message: `API responded ${res.status}`, checkedAt: new Date() };
      } catch (e) {
        return { state: "UNAVAILABLE", message: e instanceof Error ? e.message : String(e), checkedAt: new Date() };
      }
    },
  };
}
