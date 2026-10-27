import "server-only";
import { addDays, isDay, type Day } from "@/lib/dates/country-time";
import { createHttpClient } from "../http";
import { clean, cleanEmail, titleCase } from "../normalize-helpers";
import type { CompanyRegistryProvider, FetchContext, NormalizedCompany, ProviderStatus } from "../types";

/**
 * UNITED STATES — there is no national company register; companies are formed with each state's
 * Secretary of State. This adapter reads the official open-data portals (Socrata SODA API, no key)
 * of the states that publish their business register with a filing date and daily updates:
 *
 *  - New York  — Department of State, "Active Corporations: Beginning 1800" (data.ny.gov n9v6-gdp6)
 *  - Colorado  — Secretary of State, "Business Entities in Colorado" (data.colorado.gov 4ykn-tg5h)
 *  - Connecticut — Secretary of the State, "Business Registry – Business Master" (data.ct.gov n7gp-d28j)
 *  - Oregon    — Secretary of State, "Active Businesses – ALL" (data.oregon.gov tckn-sxa6; one row per
 *                address / representative, grouped per registry number; added 27 Oct 2026)
 *
 * Verified 26–27 Oct 2026: each dataset is refreshed daily; the newest filing dates trail the
 * calendar by about 1–3 days. Registration numbers are prefixed with the state ("NY-8055110"), so
 * deduplication is per state register. Not-for-profit entities are excluded; foreign entities that
 * register to do business in the state are kept and marked as such (not new legal entities).
 */
type Row = Record<string, string | undefined>;

type StateFeed = {
  state: "NY" | "CO" | "CT" | "OR";
  stateName: string;
  host: string;
  dataset: string;
  dateField: string;
  idField: string;
  /** SoQL condition excluding not-for-profit entities. */
  exclude: string;
  docs: string;
  /** Feeds with several rows per entity merge them into one row (rows share `idField`). */
  group?(rows: Row[]): Row;
  map(r: Row): Omit<NormalizedCompany, "identity" | "source"> & { name?: string; publishedAt?: Date };
};

const day = (v?: string) => (v && isDay(v.slice(0, 10)) ? v.slice(0, 10) : undefined);
const sentence = (v?: string) => (v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : undefined);
const US_STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split(" "));

export const US_FEEDS: StateFeed[] = [
  {
    state: "NY",
    stateName: "New York",
    host: "data.ny.gov",
    dataset: "n9v6-gdp6",
    dateField: "initial_dos_filing_date",
    idField: "dos_id",
    exclude: "entity_type not like '%NOT-FOR-PROFIT%'",
    docs: "https://data.ny.gov/Economic-Development/Active-Corporations-Beginning-1800/n9v6-gdp6",
    map: (r) => {
      const foreign = /^FOREIGN|REGISTERED FOREIGN/.test(r.entity_type ?? "");
      const chair = clean(r.chairman_name);
      return {
        name: clean(r.current_entity_name),
        registration: { registrationDay: day(r.initial_dos_filing_date), legalForm: sentence(clean(r.entity_type)), status: "Active" },
        classification: {},
        contact: {},
        address: { business: { street: [clean(r.location_address_1), clean(r.location_address_2)].filter(Boolean).join(", ") || undefined, city: titleCase(clean(r.location_city)), postalCode: clean(r.location_zip), region: clean(r.county) ? `${titleCase(clean(r.county))} County, New York` : "New York", country: "United States" } },
        contactPerson: chair ? { name: titleCase(chair)!, role: "Chairman / CEO (as filed)" } : undefined,
        eventType: foreign ? "BRANCH" : "NEW_ENTITY",
      };
    },
  },
  {
    state: "CO",
    stateName: "Colorado",
    host: "data.colorado.gov",
    dataset: "4ykn-tg5h",
    dateField: "entityformdate",
    idField: "entityid",
    exclude: "entitytype not in ('DNC', 'FNC')",
    docs: "https://data.colorado.gov/Business/Business-Entities-in-Colorado/4ykn-tg5h",
    map: (r) => ({
      name: clean(r.entityname),
      registration: { registrationDay: day(r.entityformdate), legalForm: CO_TYPES[r.entitytype ?? ""] ?? clean(r.entitytype), status: clean(r.entitystatus) },
      classification: {},
      contact: {},
      address: { business: { street: [clean(r.principaladdress1), clean(r.principaladdress2)].filter(Boolean).join(", ") || undefined, city: clean(r.principalcity), postalCode: clean(r.principalzipcode), region: clean(r.principalstate) === "CO" ? "Colorado" : clean(r.principalstate), country: clean(r.principalcountry) === "US" ? "United States" : clean(r.principalcountry) } },
      eventType: (r.entitytype ?? "").startsWith("F") ? "BRANCH" : "NEW_ENTITY",
    }),
  },
  {
    state: "CT",
    stateName: "Connecticut",
    host: "data.ct.gov",
    dataset: "n7gp-d28j",
    dateField: "date_registration",
    idField: "accountnumber",
    exclude: "business_type != 'Non-Stock'",
    docs: "https://data.ct.gov/Business/Connecticut-Business-Registry-Business-Master/n7gp-d28j",
    map: (r) => {
      const naics = /\((\d{2,6})\)\s*$/.exec(r.naics_code ?? "");
      const created = r.create_dt ? new Date(`${r.create_dt.replace(" ", "T").slice(0, 19)}Z`) : undefined;
      return {
        name: clean(r.name),
        registration: { registrationDay: day(r.date_registration), legalForm: [clean(r.business_type), clean(r.citizenship)?.toLowerCase()].filter(Boolean).join(" · ") || undefined, status: clean(r.status) },
        classification: naics ? { industryCode: naics[1], industryDescription: clean(r.naics_code!.replace(/\(\d+\)\s*$/, "")), codeSystem: "NAICS" } : {},
        // Connecticut publishes the business email address entered at registration.
        contact: { email: cleanEmail(r.business_email_address) },
        address: { business: { street: clean(r.billingstreet), city: clean(r.billingcity), postalCode: clean(r.billingpostalcode), region: clean(r.billingstate), country: clean(r.billingcountry) } },
        eventType: r.citizenship === "Foreign" ? "BRANCH" : "NEW_ENTITY",
        publishedAt: created && !Number.isNaN(created.getTime()) ? created : undefined,
      };
    },
  },
  {
    state: "OR",
    stateName: "Oregon",
    host: "data.oregon.gov",
    dataset: "tckn-sxa6",
    dateField: "registry_date",
    idField: "registry_number",
    // Assumed business names are trade names (mostly sole traders), not new entities.
    exclude: "entity_type not in ('ASSUMED BUSINESS NAME', 'DOMESTIC NONPROFIT CORPORATION', 'FOREIGN NONPROFIT CORPORATION', 'RESERVED NAME', 'REGISTERED NAME')",
    docs: "https://data.oregon.gov/Business/Active-Businesses-ALL/tckn-sxa6",
    group: (rows) => {
      const by = (t: string) => rows.find((r) => r.associated_name_type === t);
      const place = by("PRINCIPAL PLACE OF BUSINESS") ?? by("MAILING ADDRESS") ?? rows[0]!;
      // A named person only: registered agents are often agent companies (entity_of_record_name).
      const rep = by("AUTHORIZED REPRESENTATIVE") ?? rows.find((r) => r.associated_name_type === "REGISTERED AGENT" && r.last_name);
      const repName = rep && [rep.first_name, rep.middle_name, rep.last_name, rep.suffix].filter(Boolean).join(" ");
      return { ...place, rep_type: repName ? rep!.associated_name_type : undefined, rep_name: repName || undefined };
    },
    map: (r) => {
      const rep = clean(r.rep_name);
      const st = clean(r.state);
      return {
        name: clean(r.business_name),
        registration: { registrationDay: day(r.registry_date), legalForm: sentence(clean(r.entity_type)), status: "Active" },
        classification: {},
        contact: {},
        address: { business: { street: [clean(r.address), clean(r.address_continued)].filter(Boolean).join(", ") || undefined, city: titleCase(clean(r.city)), postalCode: clean(r.zip), region: st === "OR" ? "Oregon" : st, country: st && US_STATES.has(st) ? "United States" : undefined } },
        contactPerson: rep ? { name: titleCase(rep)!, role: r.rep_type === "REGISTERED AGENT" ? "Registered agent (as filed)" : "Authorized representative (as filed)" } : undefined,
        eventType: (r.entity_type ?? "").startsWith("FOREIGN") ? "BRANCH" : "NEW_ENTITY",
      };
    },
  },
];

const CO_TYPES: Record<string, string> = {
  DLLC: "Limited liability company",
  FLLC: "Foreign limited liability company",
  DPC: "Corporation",
  "DPC-PBC": "Public benefit corporation",
  FPC: "Foreign corporation",
  DLP: "Limited partnership",
  FLP: "Foreign limited partnership",
  DLLP: "Limited liability partnership",
  FLLP: "Foreign limited liability partnership",
  DLLLP: "Limited liability limited partnership",
  FO: "Foreign entity (other)",
};

const http = createHttpClient({ name: "US state open data (Socrata)", minIntervalMs: 300, timeoutMs: 60_000 });
const PAGE = 1000;
const headers = (): Record<string, string> => (process.env.US_SOCRATA_APP_TOKEN ? { "X-App-Token": process.env.US_SOCRATA_APP_TOKEN } : {});

export function normalizeUsRow(feed: StateFeed, r: Row): NormalizedCompany | null {
  const id = clean(r[feed.idField]);
  const m = feed.map(r);
  if (!id || !m.name) return null;
  const regNo = `${feed.state}-${id}`;
  const { name, publishedAt, ...rest } = m;
  return {
    ...rest,
    identity: { sourceId: regNo, name, registrationNumber: regNo },
    source: { url: `https://${feed.host}/resource/${feed.dataset}.json?${feed.idField}=${encodeURIComponent(id)}`, publishedAt, raw: { state: feed.state, ...r } },
  };
}

async function soql<T>(feed: StateFeed, params: Record<string, string>, signal?: AbortSignal) {
  const qs = new URLSearchParams(params);
  return http.json<T>(`https://${feed.host}/resource/${feed.dataset}.json?${qs}`, { signal, headers: headers() });
}

/** Registrations of one state register between two filing days (inclusive). */
export async function fetchStateWindow(feed: StateFeed, from: Day, to: Day, ctx: FetchContext) {
  const where = `${feed.dateField} >= '${from}T00:00:00' AND ${feed.dateField} < '${addDays(to, 1)}T00:00:00' AND ${feed.exclude}`;
  const [{ n, rows: nRows } = { n: "0", rows: "0" }] = await soql<{ n: string; rows: string }[]>(feed, { $select: `count(distinct ${feed.idField}) AS n, count(*) AS rows`, $where: where }, ctx.signal);
  const total = Number(n);
  const fetched: Row[] = [];
  // ":id" breaks ties so pages stay stable; grouped feeds need every row of an entity.
  for (let offset = 0; offset < Number(nRows ?? n) && (feed.group || fetched.length < ctx.limit); offset += PAGE) {
    const rows = await soql<Row[]>(feed, { $where: where, $order: `${feed.idField}, :id`, $limit: String(PAGE), $offset: String(offset) }, ctx.signal);
    fetched.push(...rows);
    if (!rows.length) break;
  }
  const entities = feed.group ? [...Map.groupBy(fetched, (r) => r[feed.idField]).values()].map((rows) => feed.group!(rows)) : fetched;
  const out = entities.map((r) => normalizeUsRow(feed, r)).filter((c): c is NormalizedCompany => !!c);
  return { companies: out.slice(0, ctx.limit), total };
}

export function createUsSocrataProvider(): CompanyRegistryProvider {
  return {
    id: "us-state-open-data",
    countryCode: "US",
    name: "US state business registers — official open data (NY, CO, CT, OR)",
    sourceName: "US Secretaries of State (open data)",
    sourceType: "OFFICIAL_OPEN_DATA",
    freshness: "DAILY",
    isDemo: false,
    accessType: "OPEN",
    registrationDateType: "State filing / formation date (NY initial DOS filing date, CO entity formation date, CT registration date, OR registry date)",
    homepage: "https://data.ny.gov",
    docsUrl: "https://dev.socrata.com/docs/endpoints.html",
    description: "Daily-updated official business registers of New York, Colorado, Connecticut and Oregon (public domain / open data). No API key required.",
    limitations:
      "State coverage only: New York, Colorado, Connecticut and Oregon. Other states have no verified open daily register feed. New filings appear about 1–3 days after the filing date. Not-for-profit entities are excluded; foreign entities registering in a state are marked as such. Phone numbers and websites are not published; Connecticut publishes a business email address; Oregon names an authorized representative or registered agent.",
    capabilities: {
      supportsDailyRegistrations: true,
      supportsRealTimeSearch: false,
      supportsDailyUpdates: true,
      supportsRegistrationDate: true,
      supportsLookup: true,
      supportsEmail: true,
      supportsPhone: false,
      supportsMobile: false,
      supportsWebsite: false,
      supportsAddress: true,
      supportsIndustry: true,
      supportsDirectors: false,
      supportsRoles: true,
      supportsSourceUrl: true,
    },
    requiredEnv: [],
    isConfigured: () => true,
    recommendedSyncMinutes: 6 * 60,
    // Publishes with a lag: re-read the last 5 days so late filings are not missed.
    lookbackDays: 5,

    async getRegistrations(from: Day, to: Day, ctx: FetchContext) {
      if (!isDay(from) || !isDay(to)) throw new Error("Invalid date");
      const companies: NormalizedCompany[] = [];
      let total = 0;
      for (const feed of US_FEEDS) {
        const r = await fetchStateWindow(feed, from, to, { ...ctx, limit: Math.max(0, ctx.limit - companies.length) });
        total += r.total;
        companies.push(...r.companies);
        ctx.log?.(`${feed.stateName}: ${r.companies.length}/${r.total}`);
      }
      return { companies, total, complete: companies.length >= total };
    },

    async getCompany(registrationNumber) {
      const m = /^(NY|CO|CT|OR)-(.+)$/.exec(registrationNumber.trim().toUpperCase());
      const feed = m && US_FEEDS.find((f) => f.state === m[1]);
      if (!m || !feed) return null;
      const rows = await soql<Row[]>(feed, { [feed.idField]: m[2]!, $limit: feed.group ? "50" : "1" });
      return rows[0] ? normalizeUsRow(feed, feed.group ? feed.group(rows) : rows[0]) : null;
    },

    async getLatestPublication() {
      // Socrata exposes the last data update of each dataset; the oldest feed bounds freshness.
      const times = await Promise.all(US_FEEDS.map((f) => http.json<{ rowsUpdatedAt?: number }>(`https://${f.host}/api/views/${f.dataset}.json`, { headers: headers() }).then((v) => v.rowsUpdatedAt ?? 0).catch(() => 0)));
      const valid = times.filter((t) => t > 0);
      return valid.length ? new Date(Math.min(...valid) * 1000) : null;
    },

    async checkStatus(): Promise<ProviderStatus> {
      try {
        await Promise.all(US_FEEDS.map((f) => soql(f, { $limit: "1" })));
        return { state: "CONNECTED", checkedAt: new Date() };
      } catch (e) {
        return { state: "UNAVAILABLE", message: e instanceof Error ? e.message : String(e), checkedAt: new Date() };
      }
    },
  };
}
