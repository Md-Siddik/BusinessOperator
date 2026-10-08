import "server-only";
import { getCountry } from "@/config/countries";
import { toDay, type Day } from "@/lib/dates/country-time";
import { createHttpClient, ProviderHttpError } from "../http";
import { clean } from "../normalize-helpers";
import type { CompanyRegistryProvider, FetchContext, NormalizedCompany, ProviderStatus } from "../types";

/**
 * OpenCorporates — commercial FALLBACK for jurisdictions without a direct source.
 * Docs: https://api.opencorporates.com/documentation/API-Reference
 *   GET /v0.4/companies/search?jurisdiction_code=xx&incorporation_date=FROM:TO&per_page=100&page=N&api_token=…
 * `created_at` is when OpenCorporates added the record — never used as a registration date.
 * Coverage, source delay and commercial-use rights must be confirmed per jurisdiction
 * before enabling (default limits are small: 50 requests/day, 200/month).
 */
const BASE = "https://api.opencorporates.com/v0.4";
const TOKEN = () => process.env.OPENCORPORATES_API_TOKEN || "";
const http = createHttpClient({ name: "OpenCorporates", minIntervalMs: 1_000, timeoutMs: 30_000 });

type OcCompany = {
  name: string;
  company_number: string;
  jurisdiction_code: string;
  incorporation_date?: string | null;
  dissolution_date?: string | null;
  company_type?: string | null;
  registry_url?: string | null;
  current_status?: string | null;
  registered_address_in_full?: string | null;
  opencorporates_url?: string;
};

export function normalizeOpenCorporates(c: OcCompany): NormalizedCompany {
  return {
    identity: { sourceId: `${c.jurisdiction_code}/${c.company_number}`, name: c.name, registrationNumber: c.company_number },
    registration: { registrationDay: toDay(c.incorporation_date), status: clean(c.current_status ?? undefined), legalForm: clean(c.company_type ?? undefined) },
    classification: {},
    contact: {},
    address: { business: c.registered_address_in_full ? { street: clean(c.registered_address_in_full) } : undefined },
    source: { url: c.registry_url ?? c.opencorporates_url, raw: c },
  };
}

export function createOpenCorporatesProvider(countryCode: string): CompanyRegistryProvider {
  const country = getCountry(countryCode)!;
  const jurisdiction = countryCode.toLowerCase();
  return {
    id: `opencorporates-${jurisdiction}`,
    countryCode,
    name: `OpenCorporates — ${country.name} (fallback)`,
    sourceName: "OpenCorporates",
    sourceType: "COMMERCIAL",
    freshness: "UNKNOWN",
    isDemo: false,
    accessType: "COMMERCIAL",
    registrationDateType: "Incorporation date as reported by OpenCorporates (not its created_at)",
    homepage: "https://opencorporates.com",
    docsUrl: "https://api.opencorporates.com/documentation/API-Reference",
    description: `Commercial fallback aggregating ${country.registryName}. Confirm coverage, delay and licence before relying on it.`,
    limitations: "Source delay and completeness of today's registrations are not guaranteed. Free tier limits are very small.",
    capabilities: {
      supportsDailyRegistrations: true,
      supportsRealTimeSearch: false,
      supportsDailyUpdates: false,
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
    requiredEnv: ["OPENCORPORATES_API_TOKEN"],
    isConfigured: () => !!TOKEN(),
    recommendedSyncMinutes: 24 * 60,

    async getRegistrations(from: Day, to: Day, ctx: FetchContext) {
      const companies: NormalizedCompany[] = [];
      let total: number | undefined;
      for (let page = 1; page <= 100 && companies.length < ctx.limit; page++) {
        const q = new URLSearchParams({ jurisdiction_code: jurisdiction, incorporation_date: `${from}:${to}`, per_page: "100", page: String(page), order: "incorporation_date", api_token: TOKEN() });
        const res = await http.request(`${BASE}/companies/search?${q}`, { signal: ctx.signal });
        if (res.status === 401 || res.status === 403) throw new ProviderHttpError("OpenCorporates rejected the API token", res.status);
        if (res.status === 429) throw new ProviderHttpError("OpenCorporates rate limit reached", 429, true);
        if (!res.ok) throw new ProviderHttpError(`OpenCorporates responded ${res.status}`, res.status, true);
        const data = (await res.json()) as { results?: { companies?: { company: OcCompany }[]; total_count?: number; total_pages?: number } };
        total = data.results?.total_count ?? total;
        const items = data.results?.companies ?? [];
        companies.push(...items.map((x) => normalizeOpenCorporates(x.company)));
        if (!items.length || page >= (data.results?.total_pages ?? 1)) break;
      }
      return { companies: companies.slice(0, ctx.limit), total, complete: total === undefined || companies.length >= total };
    },

    async checkStatus(): Promise<ProviderStatus> {
      if (!TOKEN()) return { state: "CREDENTIALS_REQUIRED", message: "Set OPENCORPORATES_API_TOKEN (commercial licence required for prospecting).", checkedAt: new Date() };
      return { state: "CONNECTED", checkedAt: new Date() };
    },
  };
}
