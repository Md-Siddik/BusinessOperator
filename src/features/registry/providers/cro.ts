import "server-only";
import { isDay, toDay, type Day } from "@/lib/dates/country-time";
import { createHttpClient } from "../http";
import { clean, titleCase } from "../normalize-helpers";
import type { CompanyRegistryProvider, FetchContext, NormalizedCompany, ProviderStatus } from "../types";

/**
 * IRELAND — Companies Registration Office open data (CKAN), "Company Records" dataset.
 * Licence CC BY 4.0. Queried with datastore_search_sql by company_reg_date.
 * Docs: https://opendata.cro.ie/dataset/companies
 *
 * The publisher labels the dataset "Daily". The actual resource modification time
 * is exposed via getLatestPublication() and shown on Data Sources (observed lag).
 * No email / phone fields.
 */
const BASE = (process.env.IRELAND_CRO_API_URL || "https://opendata.cro.ie/api/3/action").replace(/\/$/, "");
const DATASET = "companies";
const RESOURCE = process.env.IRELAND_CRO_RESOURCE_ID || "3fef41bc-b8f4-4b10-8434-ce51c29b1bba";
const PAGE = 1000;
const http = createHttpClient({ name: "CRO open data", minIntervalMs: 500, timeoutMs: 60_000 });

export type CroRecord = {
  company_num: string | number;
  company_name: string;
  company_reg_date?: string | null;
  company_type?: string | null;
  company_status?: string | null;
  company_address_1?: string | null;
  company_address_2?: string | null;
  company_address_3?: string | null;
  company_address_4?: string | null;
  eircode?: string | null;
  nace_v2_code?: string | null;
};

const PLACEHOLDER = /\*{3,}|NO ADDRESS DETAILS/i;
const part = (v: string | null | undefined) => (v && !PLACEHOLDER.test(v) ? clean(v) : undefined);

export function normalizeCroRecord(r: CroRecord): NormalizedCompany {
  const num = String(r.company_num);
  const nace = r.nace_v2_code && /^\d{4}$/.test(r.nace_v2_code) ? `${r.nace_v2_code.slice(0, 2)}.${r.nace_v2_code.slice(2)}` : undefined;
  const line4 = part(r.company_address_4);
  // Address line 4 is usually "Town, COUNTY, Ireland".
  const [town, county] = (line4 ?? "").split(",").map((x) => x.trim());
  return {
    identity: { sourceId: num, name: clean(r.company_name) ?? num, registrationNumber: num },
    registration: {
      registrationDay: toDay(r.company_reg_date ?? undefined),
      status: clean(r.company_status ?? undefined),
      legalForm: clean(r.company_type ?? undefined),
      legalFormCode: clean(r.company_type ?? undefined)?.split(" - ")[0],
    },
    classification: { industryCode: r.nace_v2_code ?? undefined, codeSystem: nace ? "NACE Rev. 2" : undefined, naceCode: nace },
    contact: {},
    address: {
      business: {
        street: [part(r.company_address_1), part(r.company_address_2), part(r.company_address_3)].filter(Boolean).join(", ") || undefined,
        postalCode: clean(r.eircode ?? undefined),
        city: titleCase(town || undefined),
        region: titleCase(county || undefined),
        country: "Ireland",
      },
    },
    source: { raw: r },
  };
}

async function sql<T>(query: string, signal?: AbortSignal) {
  const data = await http.json<{ success: boolean; result?: { records: T[] }; error?: unknown }>(`${BASE}/datastore_search_sql?sql=${encodeURIComponent(query)}`, { signal });
  if (!data.success) throw new Error(`CRO query failed: ${JSON.stringify(data.error).slice(0, 200)}`);
  return data.result?.records ?? [];
}

const COLUMNS = "company_num,company_name,company_reg_date,company_type,company_status,company_address_1,company_address_2,company_address_3,company_address_4,eircode,nace_v2_code";

export function createCroProvider(): CompanyRegistryProvider {
  return {
    id: "cro",
    countryCode: "IE",
    name: "CRO — Company Records open data",
    sourceName: "Companies Registration Office (CRO)",
    sourceType: "OFFICIAL_OPEN_DATA",
    freshness: "DAILY",
    isDemo: false,
    accessType: "OPEN",
    registrationDateType: "CRO company registration date (company_reg_date)",
    homepage: "https://opendata.cro.ie",
    docsUrl: "https://opendata.cro.ie/dataset/companies",
    description: "Official Irish company register open data (CC BY 4.0). No API key required.",
    limitations: "No email or phone fields. The dataset can lag its 'daily' label — check the latest publication time on Data Sources.",
    capabilities: {
      supportsDailyRegistrations: true,
      supportsRealTimeSearch: false,
      supportsDailyUpdates: true,
      supportsRegistrationDate: true,
      supportsLookup: true,
      supportsEmail: false,
      supportsPhone: false,
      supportsMobile: false,
      supportsWebsite: false,
      supportsAddress: true,
      supportsIndustry: true,
      supportsDirectors: false,
      supportsRoles: false,
      supportsSourceUrl: false,
    },
    requiredEnv: [],
    isConfigured: () => true,
    recommendedSyncMinutes: 6 * 60,

    async getRegistrations(from: Day, to: Day, ctx: FetchContext) {
      if (!isDay(from) || !isDay(to)) throw new Error("Invalid date");
      const next = new Date(`${to}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      const end = next.toISOString().slice(0, 10);
      const [{ n } = { n: 0 }] = await sql<{ n: number }>(`SELECT count(*) AS n FROM "${RESOURCE}" WHERE company_reg_date >= '${from}' AND company_reg_date < '${end}'`, ctx.signal);
      const total = Number(n);
      const companies: NormalizedCompany[] = [];
      for (let offset = 0; offset < total && companies.length < ctx.limit; offset += PAGE) {
        const rows = await sql<CroRecord>(`SELECT ${COLUMNS} FROM "${RESOURCE}" WHERE company_reg_date >= '${from}' AND company_reg_date < '${end}' ORDER BY company_num LIMIT ${PAGE} OFFSET ${offset}`, ctx.signal);
        companies.push(...rows.map(normalizeCroRecord));
        ctx.log?.(`Fetched ${companies.length}/${total}`);
        if (!rows.length) break;
      }
      return { companies: companies.slice(0, ctx.limit), total, complete: companies.length >= total };
    },

    async getCompany(num) {
      if (!/^\d{1,8}$/.test(num)) return null;
      const rows = await sql<CroRecord>(`SELECT ${COLUMNS} FROM "${RESOURCE}" WHERE company_num = ${Number(num)} LIMIT 1`);
      return rows[0] ? normalizeCroRecord(rows[0]) : null;
    },

    async getLatestPublication() {
      const data = await http.json<{ result?: { resources?: { id: string; last_modified?: string }[] } }>(`${BASE}/package_show?id=${DATASET}`);
      const mod = data.result?.resources?.find((r) => r.id === RESOURCE)?.last_modified;
      return mod ? new Date(`${mod}Z`) : null;
    },

    async checkStatus(): Promise<ProviderStatus> {
      try {
        await http.json(`${BASE}/package_show?id=${DATASET}`);
        return { state: "CONNECTED", checkedAt: new Date() };
      } catch (e) {
        return { state: "UNAVAILABLE", message: e instanceof Error ? e.message : String(e), checkedAt: new Date() };
      }
    },
  };
}
