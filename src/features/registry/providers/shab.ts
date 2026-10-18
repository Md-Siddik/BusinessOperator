import "server-only";
import { XMLParser } from "fast-xml-parser";
import { eachDay, isDay, type Day } from "@/lib/dates/country-time";
import { createHttpClient, mapLimit } from "../http";
import { clean, joinStreet } from "../normalize-helpers";
import type { CompanyRegistryProvider, FetchContext, NormalizedCompany, ProviderStatus } from "../types";

/**
 * SWITZERLAND — Swiss Official Gazette of Commerce (SHAB / FOSC), commercial-register
 * publications "HR01 — Neueintragung" (new entries), via the Official Gazettes Portal API
 * operated by SECO. Public: "The API is freely accessible for anyone to use"; no user
 * profile is required for published data. Docs: https://amtsblattportal.ch/docs/api/
 *
 * Registration date = journalDate (Tagebuchdatum): the day the cantonal commercial
 * register entered the company, which is when it becomes legally effective. SHAB
 * publishes it one to a few working days later, so a sync window selects publications
 * by publication date and stores each company under its real journal date.
 * The operator states that only the signed PDF is legally binding; its link is the source URL.
 */
const BASE = (process.env.SWITZERLAND_SHAB_API_URL || "https://amtsblattportal.ch/api/v1").replace(/\/$/, "");
const http = createHttpClient({ name: "SHAB (Official Gazettes Portal)", minIntervalMs: 250, timeoutMs: 30_000 });
const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, processEntities: true, parseTagValue: false, trimValues: true });
/** Sole proprietorships are natural persons; excluded unless explicitly enabled. */
const includeSoleTraders = () => process.env.SWITZERLAND_INCLUDE_SOLE_TRADERS === "true";

type ListItem = { meta: { id: string; publicationDate?: string; cantons?: string[]; language?: string } };

type Hr01Address = { street?: string; houseNumber?: string; swissZipCode?: string; town?: string; addressLine?: string };
export type Hr01 = {
  meta?: { id?: string; publicationDate?: string; cantons?: string; language?: string; publicationNumber?: string };
  content?: {
    journalDate?: string;
    publicationText?: string;
    commonsNew?: {
      company?: { name?: string; uid?: string; seat?: string; legalForm?: string; address?: Hr01Address };
      purpose?: string;
    };
  };
};

/** "…, Gesellschaft mit beschränkter Haftung (Neueintragung)." → the legal form as published. */
export function legalFormFromText(text: string | undefined) {
  const m = /,\s*([^,()]+?)\s*\((?:Neueintragung|Nouvelle inscription|Nuova iscrizione|Nouva inscripziun)\)/i.exec(text ?? "");
  return clean(m?.[1]);
}

/** Legal form code 0101 = sole proprietorship (Einzelunternehmen). */
const SOLE_PROPRIETORSHIP = "0101";

export function normalizeHr01(x: Hr01, publicationId: string): NormalizedCompany | null {
  const company = x.content?.commonsNew?.company;
  const journal = x.content?.journalDate;
  const uid = clean(company?.uid);
  const name = clean(company?.name);
  if (!uid || !name) return null;
  const legalForm = legalFormFromText(x.content?.publicationText);
  const a = company?.address;
  const pub = x.meta?.publicationDate;
  return {
    identity: { sourceId: uid, name, registrationNumber: uid },
    registration: {
      registrationDay: journal && isDay(journal) ? journal : undefined,
      status: "Registered",
      legalForm,
      legalFormCode: clean(company?.legalForm),
    },
    classification: { purpose: clean(x.content?.commonsNew?.purpose)?.slice(0, 2000) },
    contact: {},
    address: {
      business: a
        ? { street: joinStreet([a.street, a.houseNumber]) ?? clean(a.addressLine), postalCode: clean(a.swissZipCode), city: clean(a.town) ?? clean(company?.seat), region: clean(x.meta?.cantons), country: "Switzerland" }
        : { city: clean(company?.seat), region: clean(x.meta?.cantons), country: "Switzerland" },
    },
    eventType: /zweigniederlassung|succursale/i.test(legalForm ?? "") ? "BRANCH" : "NEW_ENTITY",
    source: { url: `${BASE}/publications/${publicationId}/pdf`, publishedAt: pub && isDay(pub) ? new Date(`${pub}T00:00:00Z`) : undefined, raw: x },
  };
}

/**
 * One request per publication day with the API's maximum page size (2000; a day has
 * ~200–250 new entries). Paging inside a day is avoided on purpose: all entries of a day
 * share the sort key, so page boundaries are not stable between requests.
 */
const MAX_PAGE = 2000;
async function listPublications(from: Day, to: Day, ctx: FetchContext) {
  const ids: string[] = [];
  let total = 0;
  for (const day of eachDay(from, to)) {
    const q = new URLSearchParams({ publicationStates: "PUBLISHED", subRubrics: "HR01", tenant: "shab", "publicationDate.start": day, "publicationDate.end": day, "pageRequest.size": String(MAX_PAGE), "pageRequest.page": "0" });
    const data = await http.json<{ total?: number; content?: ListItem[] }>(`${BASE}/publications?${q}`, { signal: ctx.signal });
    const items = data.content ?? [];
    total += Math.max(data.total ?? 0, items.length);
    ids.push(...items.map((i) => i.meta.id));
    if (ids.length >= ctx.limit) break;
  }
  return { ids: [...new Set(ids)].slice(0, ctx.limit), total };
}

async function fetchHr01(id: string, signal?: AbortSignal): Promise<Hr01> {
  const res = await http.request(`${BASE}/publications/${encodeURIComponent(id)}/xml`, { signal, headers: { Accept: "application/xml" } });
  if (!res.ok) throw new Error(`SHAB responded ${res.status} for publication ${id}`);
  const doc = parser.parse(await res.text()) as { publication?: Hr01 };
  return doc.publication ?? {};
}

export function createShabProvider(): CompanyRegistryProvider {
  return {
    id: "shab",
    countryCode: "CH",
    name: "SHAB / FOSC — commercial register new entries (HR01)",
    sourceName: "Swiss Official Gazette of Commerce (SHAB)",
    sourceType: "OFFICIAL_REGISTRY",
    freshness: "DAILY",
    isDemo: false,
    accessType: "OPEN",
    registrationDateType: "Commercial register journal date (Tagebuchdatum); published in SHAB 1–5 working days later",
    homepage: "https://www.shab.ch",
    docsUrl: "https://amtsblattportal.ch/docs/api/",
    description: "Official Swiss new commercial-register entries published in the SHAB. Public API, no key.",
    limitations: "SHAB publishes each entry a few days after its journal date, so today's count fills in over the next days. No industry code, email, phone or website. Sole proprietorships are excluded by default.",
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
    recommendedSyncMinutes: 3 * 60,
    windowBy: "publication",

    /** Entries PUBLISHED from `from` to `to`, each stored under its real journal (registration) date. */
    async getRegistrations(from: Day, to: Day, ctx: FetchContext) {
      if (!isDay(from) || !isDay(to)) throw new Error("Invalid date");
      const { ids, total } = await listPublications(from, to, ctx);
      ctx.log?.(`Found ${total} new-entry publications; fetching details…`);
      let done = 0;
      let failed = 0;
      const soleTraders = includeSoleTraders();
      const results = await mapLimit(ids, 4, async (id) => {
        try {
          const x = await fetchHr01(id, ctx.signal);
          if (++done % 25 === 0) ctx.log?.(`Fetched ${done}/${ids.length} publications`);
          if (!soleTraders && x.content?.commonsNew?.company?.legalForm === SOLE_PROPRIETORSHIP) return null;
          return normalizeHr01(x, id);
        } catch (e) {
          failed++;
          ctx.log?.(`Publication ${id} could not be read: ${e instanceof Error ? e.message : String(e)}`);
          return null;
        }
      });
      // A few unreadable entries are retried by the next run; a broken source fails the run.
      if (failed && failed > Math.max(3, ids.length * 0.1)) throw new Error(`SHAB: ${failed} of ${ids.length} publications could not be read.`);
      const companies = results.filter((c): c is NormalizedCompany => !!c && !!c.registration.registrationDay);
      return { companies, total, complete: !failed && ids.length >= total };
    },

    async getLatestPublication() {
      const q = new URLSearchParams({ publicationStates: "PUBLISHED", subRubrics: "HR01", tenant: "shab", "pageRequest.size": "1", "pageRequest.sortOrders": "column:PUBLICATION_DATE|direction:DESC" });
      const data = await http.json<{ content?: ListItem[] }>(`${BASE}/publications?${q}`);
      const d = data.content?.[0]?.meta.publicationDate;
      return d ? new Date(d) : null;
    },

    async checkStatus(): Promise<ProviderStatus> {
      try {
        await http.json(`${BASE}/publications?publicationStates=PUBLISHED&subRubrics=HR01&pageRequest.size=1`);
        return { state: "CONNECTED", checkedAt: new Date() };
      } catch (e) {
        return { state: "UNAVAILABLE", message: e instanceof Error ? e.message : String(e), checkedAt: new Date() };
      }
    },
  };
}
