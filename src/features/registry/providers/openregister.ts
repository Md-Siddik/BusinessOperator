import "server-only";
import { eachDay, toDay, type Day } from "@/lib/dates/country-time";
import { createHttpClient, ProviderHttpError } from "../http";
import { clean, titleCase } from "../normalize-helpers";
import type { CompanyRegistryProvider, FetchContext, NormalizedCompany, ProviderStatus } from "../types";

/**
 * GERMANY — OpenRegister (commercial aggregator of Handelsregister data).
 * Docs: https://docs.openregister.de/endpoint/filter-company
 *   POST https://api.openregister.de/v1/search/company   Authorization: Bearer <key>
 *   body { filters: [{ field: "incorporated_at", min, max }], page, per_page }   dates YYYY-MM-DD
 * Results carry name, register number/type/court, legal form, address, purpose.
 * Contact fields are not evidenced in search results → contacts come from research.
 * Queried one day at a time so every record's registration day is the filter day.
 * Publication delay must be measured before any freshness better than UNKNOWN is claimed.
 */
const BASE = (process.env.OPENREGISTER_API_URL || "https://api.openregister.de").replace(/\/$/, "");
const KEY = () => process.env.OPENREGISTER_API_KEY || "";
const http = createHttpClient({ name: "OpenRegister", minIntervalMs: 500, timeoutMs: 30_000 });

export type OpenRegisterCompany = {
  company_id: string;
  name: string;
  country?: string;
  register_number?: string;
  register_type?: string;
  register_court?: string;
  active?: boolean;
  legal_form?: string;
  incorporated_at?: string;
  address?: { street?: string; city?: string; postal_code?: string; country?: string; formatted_value?: string };
  purpose?: string;
};

export function normalizeOpenRegister(c: OpenRegisterCompany, day?: Day): NormalizedCompany {
  const reg = [c.register_type, c.register_number].filter(Boolean).join(" ");
  const regNo = [reg, c.register_court].filter(Boolean).join(", ") || c.company_id;
  return {
    identity: { sourceId: c.company_id, name: c.name, registrationNumber: regNo },
    registration: { registrationDay: toDay(c.incorporated_at) ?? day, status: c.active === false ? "Inactive" : "Active", legalForm: clean(c.legal_form), legalFormCode: clean(c.legal_form) },
    classification: { purpose: clean(c.purpose), businessActivity: clean(c.purpose) },
    contact: {},
    address: { business: c.address ? { street: clean(c.address.street), postalCode: clean(c.address.postal_code), city: titleCase(clean(c.address.city)), country: clean(c.address.country) } : undefined },
    source: { raw: c },
  };
}

async function search(day: Day, page: number, signal?: AbortSignal) {
  const res = await http.request(`${BASE}/v1/search/company`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ filters: [{ field: "incorporated_at", min: day, max: day }], page, per_page: 100 }),
    signal,
  });
  if (res.status === 401 || res.status === 403) throw new ProviderHttpError("OpenRegister rejected the API key", res.status);
  if (res.status === 429) throw new ProviderHttpError("OpenRegister rate limit / credits exhausted", 429, true);
  if (!res.ok) throw new ProviderHttpError(`OpenRegister responded ${res.status}`, res.status, true);
  const data = (await res.json()) as { results?: OpenRegisterCompany[]; companies?: OpenRegisterCompany[]; total_pages?: number; total_results?: number; pagination?: { total_pages?: number; total_results?: number } };
  return { items: data.results ?? data.companies ?? [], totalPages: data.total_pages ?? data.pagination?.total_pages ?? 1, total: data.total_results ?? data.pagination?.total_results };
}

export function createOpenRegisterProvider(): CompanyRegistryProvider {
  return {
    id: "openregister",
    countryCode: "DE",
    name: "OpenRegister — Handelsregister data API",
    sourceName: "OpenRegister (Handelsregister data)",
    sourceType: "COMMERCIAL",
    freshness: "UNKNOWN",
    isDemo: false,
    accessType: "COMMERCIAL",
    registrationDateType: "incorporated_at as reported by OpenRegister",
    homepage: "https://openregister.de",
    docsUrl: "https://docs.openregister.de/endpoint/filter-company",
    description: "Commercial access to German commercial register data (API key, credit-based).",
    limitations: "No official German registry API exists. Publication delay is measured after activation; contacts come from research.",
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
    requiredEnv: ["OPENREGISTER_API_KEY"],
    isConfigured: () => !!KEY(),
    recommendedSyncMinutes: 12 * 60,

    async getRegistrations(from: Day, to: Day, ctx: FetchContext) {
      const companies: NormalizedCompany[] = [];
      let total = 0;
      let complete = true;
      for (const day of eachDay(from, to)) {
        for (let page = 1; page <= 100; page++) {
          const r = await search(day, page, ctx.signal);
          if (page === 1) total += r.total ?? 0;
          companies.push(...r.items.map((c) => normalizeOpenRegister(c, day)));
          if (companies.length >= ctx.limit) {
            complete = false;
            break;
          }
          if (page >= r.totalPages || !r.items.length) break;
        }
      }
      return { companies: companies.slice(0, ctx.limit), total: total || undefined, complete };
    },

    async checkStatus(): Promise<ProviderStatus> {
      if (!KEY()) return { state: "CREDENTIALS_REQUIRED", message: "Set OPENREGISTER_API_KEY.", checkedAt: new Date() };
      try {
        await search(new Date().toISOString().slice(0, 10), 1);
        return { state: "CONNECTED", checkedAt: new Date() };
      } catch (e) {
        const status = (e as { status?: number }).status;
        return { state: status === 401 || status === 403 ? "CREDENTIALS_REQUIRED" : "UNAVAILABLE", message: e instanceof Error ? e.message : String(e), checkedAt: new Date() };
      }
    },
  };
}
