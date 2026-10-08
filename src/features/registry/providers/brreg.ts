import "server-only";
import { toDay, type Day } from "@/lib/dates/country-time";
import { createHttpClient } from "../http";
import { clean, cleanEmail, cleanPhone, cleanWebsite, titleCase } from "../normalize-helpers";
import { mapLimit } from "../http";
import type { ChangeBatch, CompanyRegistryProvider, FetchContext, NormalizedAddress, NormalizedCompany, NormalizedPerson, ProviderStatus } from "../types";

/**
 * NORWAY — Brønnøysundregistrene, Enhetsregisteret open data API.
 * Official, public, no API key. Docs: https://data.brreg.no/enhetsregisteret/api/dokumentasjon/no/index.html
 *
 * Daily view: GET /enheter?fraRegistreringsdatoEnhetsregisteret=D&tilRegistreringsdatoEnhetsregisteret=D
 * Roles:      GET /enheter/{orgnr}/roller
 * Contact fields (epostadresse, telefon, mobil, hjemmeside) are published when the
 * entity has registered them — many new entities have not, and that is shown as such.
 */
const BASE = (process.env.BRREG_API_URL || "https://data.brreg.no/enhetsregisteret/api").replace(/\/$/, "");
const PAGE_SIZE = 500; // the API allows (page + 1) * size ≤ 10 000

const http = createHttpClient({ name: "Brønnøysundregistrene", minIntervalMs: 250, timeoutMs: 25_000 });

type BrregAdresse = { adresse?: string[]; postnummer?: string; poststed?: string; kommune?: string; kommunenummer?: string; land?: string; landkode?: string };
export type BrregEnhet = {
  organisasjonsnummer: string;
  navn: string;
  organisasjonsform?: { kode: string; beskrivelse: string };
  registreringsdatoEnhetsregisteret?: string;
  stiftelsesdato?: string;
  naeringskode1?: { kode: string; beskrivelse: string };
  forretningsadresse?: BrregAdresse;
  postadresse?: BrregAdresse;
  hjemmeside?: string;
  epostadresse?: string;
  telefon?: string;
  mobil?: string;
  antallAnsatte?: number;
  harRegistrertAntallAnsatte?: boolean;
  aktivitet?: string[];
  vedtektsfestetFormaal?: string[];
  konkurs?: boolean;
  underAvvikling?: boolean;
  underTvangsavviklingEllerTvangsopplosning?: boolean;
  slettedato?: string;
};

type BrregRolle = {
  type?: { kode?: string; beskrivelse?: string };
  person?: { navn?: { fornavn?: string; mellomnavn?: string; etternavn?: string }; erDoed?: boolean };
  enhet?: { organisasjonsnummer?: string; navn?: string[] };
  fratraadt?: boolean;
  avregistrert?: boolean;
};
export type BrregRoller = { rollegrupper?: { type?: { kode?: string; beskrivelse?: string }; roller?: BrregRolle[] }[] };

function address(a: BrregAdresse | undefined): NormalizedAddress | undefined {
  if (!a) return undefined;
  return {
    street: a.adresse?.map((x) => clean(x)).filter(Boolean).join(", ") || undefined,
    postalCode: clean(a.postnummer),
    city: titleCase(clean(a.poststed)),
    region: titleCase(clean(a.kommune)),
    country: clean(a.land),
  };
}

function status(e: BrregEnhet) {
  if (e.slettedato) return "Deleted";
  if (e.konkurs) return "Bankrupt";
  if (e.underTvangsavviklingEllerTvangsopplosning) return "Compulsory dissolution";
  if (e.underAvvikling) return "Under dissolution";
  return "Active";
}

export function sourceUrlFor(orgnr: string) {
  return `https://virksomhet.brreg.no/nb/oppslag/enheter/${orgnr}`;
}

/** Map one Enhetsregisteret record. Exported for tests. */
export function normalizeBrregEnhet(e: BrregEnhet): NormalizedCompany {
  const nace = e.naeringskode1 && e.naeringskode1.kode !== "00.000" ? e.naeringskode1 : undefined;
  return {
    identity: { sourceId: e.organisasjonsnummer, name: e.navn, registrationNumber: e.organisasjonsnummer },
    registration: {
      registrationDay: toDay(e.registreringsdatoEnhetsregisteret),
      incorporationDay: toDay(e.stiftelsesdato),
      status: status(e),
      legalForm: e.organisasjonsform?.beskrivelse,
      legalFormCode: e.organisasjonsform?.kode,
    },
    classification: {
      industryCode: nace?.kode,
      industryDescription: nace?.beskrivelse,
      codeSystem: nace ? "SN2007 (NACE Rev. 2)" : undefined,
      naceCode: nace?.kode,
      businessActivity: e.aktivitet?.map((x) => clean(x)).filter(Boolean).join(" ") || undefined,
      purpose: e.vedtektsfestetFormaal?.map((x) => clean(x)).filter(Boolean).join(" ") || undefined,
    },
    contact: {
      email: cleanEmail(e.epostadresse),
      phone: cleanPhone(e.telefon, "NO"),
      mobile: cleanPhone(e.mobil, "NO"),
      website: cleanWebsite(e.hjemmeside),
    },
    address: { business: address(e.forretningsadresse), postal: address(e.postadresse) },
    employees: e.harRegistrertAntallAnsatte ? e.antallAnsatte : undefined,
    source: { url: sourceUrlFor(e.organisasjonsnummer), raw: e },
  };
}

const CONTACT_ROLE_PRIORITY = ["KONT", "DAGL", "INNH", "LEDE", "DTPR", "DTSO"];

/** Map the roles response. Birth dates are deliberately not stored (data minimisation). Exported for tests. */
export function normalizeBrregRoller(r: BrregRoller): { people: NormalizedPerson[]; contactPerson?: NormalizedPerson } {
  const people: NormalizedPerson[] = [];
  for (const group of r.rollegrupper ?? []) {
    for (const rolle of group.roller ?? []) {
      if (rolle.fratraadt || rolle.avregistrert || rolle.person?.erDoed) continue;
      const n = rolle.person?.navn;
      const name = n ? [n.fornavn, n.mellomnavn, n.etternavn].filter(Boolean).join(" ") : rolle.enhet?.navn?.join(" ");
      if (!name) continue;
      people.push({ name: clean(name)!, role: rolle.type?.beskrivelse ?? "Role", roleCode: rolle.type?.kode, group: group.type?.beskrivelse });
    }
  }
  const persons = people.filter((p) => p.roleCode && !["REVI", "REGN"].includes(p.roleCode));
  const contactPerson = CONTACT_ROLE_PRIORITY.map((code) => persons.find((p) => p.roleCode === code)).find(Boolean);
  return { people, contactPerson };
}

type BrregUpdate = { oppdateringsid: number; dato: string; endringstype: string; organisasjonsnummer: string };

/**
 * Incremental feed: GET /oppdateringer/enheter?oppdateringsid={next}&size=200
 * (inclusive of the given id). endringstype: Ny | Endring | Sletting | Fjernet | Ukjent.
 * "Ny" = a new legal entity in Enhetsregisteret; "Fjernet" = removed (must be deleted here too).
 */
export async function pollBrregChanges(cursor: string | null, ctx: FetchContext): Promise<ChangeBatch> {
  if (!cursor) {
    // Initialise a few minutes back; the day sync covers anything earlier.
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const data = await http.json<{ _embedded?: { oppdaterteEnheter?: BrregUpdate[] } }>(`${BASE}/oppdateringer/enheter?dato=${encodeURIComponent(since)}&size=1`, { signal: ctx.signal });
    const first = data._embedded?.oppdaterteEnheter?.[0]?.oppdateringsid;
    return { newCompanies: [], changedIds: [], removedIds: [], cursor: String(first ? first - 1 : 0), publishedAts: [], more: false };
  }
  const size = Math.min(200, ctx.limit);
  const data = await http.json<{ _embedded?: { oppdaterteEnheter?: BrregUpdate[] }; page?: { totalElements?: number } }>(`${BASE}/oppdateringer/enheter?oppdateringsid=${Number(cursor) + 1}&size=${size}`, { signal: ctx.signal });
  const updates = data._embedded?.oppdaterteEnheter ?? [];
  if (!updates.length) return { newCompanies: [], changedIds: [], removedIds: [], cursor, publishedAts: [], more: false };
  const fresh = updates.filter((u) => u.endringstype === "Ny");
  const newCompanies = (
    await mapLimit(fresh, 2, async (u) => {
      try {
        const res = await http.request(`${BASE}/enheter/${u.organisasjonsnummer}`, { signal: ctx.signal });
        if (!res.ok) return null;
        const n = normalizeBrregEnhet((await res.json()) as BrregEnhet);
        n.source.publishedAt = new Date(u.dato);
        return n;
      } catch {
        return null; // stays in the feed window; the day sync reconciles it
      }
    })
  ).filter((x): x is NormalizedCompany => !!x);
  return {
    newCompanies,
    changedIds: updates.filter((u) => u.endringstype === "Endring" || u.endringstype === "Sletting").map((u) => u.organisasjonsnummer),
    removedIds: updates.filter((u) => u.endringstype === "Fjernet").map((u) => u.organisasjonsnummer),
    cursor: String(updates[updates.length - 1]!.oppdateringsid),
    publishedAts: fresh.map((u) => new Date(u.dato)),
    more: updates.length >= size,
  };
}

async function status_(): Promise<ProviderStatus> {
  try {
    const res = await http.request(`${BASE}/enheter?size=1`);
    await res.body?.cancel().catch(() => undefined);
    return res.ok ? { state: "CONNECTED", checkedAt: new Date() } : { state: "UNAVAILABLE", message: `API responded ${res.status}`, checkedAt: new Date() };
  } catch (e) {
    return { state: "UNAVAILABLE", message: e instanceof Error ? e.message : String(e), checkedAt: new Date() };
  }
}

export function createBrregProvider(): CompanyRegistryProvider {
  return {
    id: "brreg",
    countryCode: "NO",
    name: "Brønnøysundregistrene — Enhetsregisteret",
    sourceName: "Brønnøysundregistrene",
    sourceType: "OFFICIAL_REGISTRY",
    freshness: "REAL_TIME",
    isDemo: false,
    accessType: "OPEN",
    registrationDateType: "Enhetsregisteret registration date (registreringsdatoEnhetsregisteret)",
    homepage: "https://www.brreg.no",
    docsUrl: "https://data.brreg.no/enhetsregisteret/api/dokumentasjon/no/index.html",
    description: "Official Norwegian register of legal entities. Queried live; no API key required.",
    limitations: "Email, phone and website are only published when the company has registered them — most new companies have not yet.",
    capabilities: {
      supportsDailyRegistrations: true,
      supportsRealTimeSearch: true,
      supportsDailyUpdates: true,
      supportsRegistrationDate: true,
      supportsLookup: true,
      supportsEmail: true,
      supportsPhone: true,
      supportsMobile: true,
      supportsWebsite: true,
      supportsAddress: true,
      supportsIndustry: true,
      supportsDirectors: true,
      supportsRoles: true,
      supportsSourceUrl: true,
    },
    requiredEnv: [],
    isConfigured: () => true,
    recommendedSyncMinutes: 30,

    async getRegistrations(from: Day, to: Day, ctx: FetchContext) {
      const companies: NormalizedCompany[] = [];
      let total: number | undefined;
      for (let page = 0; companies.length < ctx.limit && (page + 1) * PAGE_SIZE <= 10_000; page++) {
        const url = `${BASE}/enheter?fraRegistreringsdatoEnhetsregisteret=${from}&tilRegistreringsdatoEnhetsregisteret=${to}&size=${PAGE_SIZE}&page=${page}`;
        const data = await http.json<{ _embedded?: { enheter?: BrregEnhet[] }; page?: { totalElements?: number; totalPages?: number } }>(url, { signal: ctx.signal });
        total = data.page?.totalElements ?? total;
        const items = data._embedded?.enheter ?? [];
        companies.push(...items.map(normalizeBrregEnhet));
        ctx.log?.(`Fetched page ${page + 1}/${data.page?.totalPages ?? 1} (${companies.length}/${total ?? "?"})`);
        if (!items.length || page + 1 >= (data.page?.totalPages ?? 0)) break;
      }
      const capped = companies.slice(0, ctx.limit);
      return { companies: capped, total, complete: total === undefined || capped.length >= total };
    },

    async getCompany(orgnr, ctx) {
      const res = await http.request(`${BASE}/enheter/${encodeURIComponent(orgnr)}`, { signal: ctx?.signal });
      if (res.status === 404 || res.status === 410) return null;
      if (!res.ok) throw new Error(`Brønnøysundregistrene responded ${res.status}`);
      return normalizeBrregEnhet((await res.json()) as BrregEnhet);
    },

    async getPeople(orgnr, ctx) {
      const res = await http.request(`${BASE}/enheter/${encodeURIComponent(orgnr)}/roller`, { signal: ctx?.signal });
      if (res.status === 404) return { people: [] };
      if (!res.ok) throw new Error(`Brønnøysundregistrene roles responded ${res.status}`);
      return normalizeBrregRoller((await res.json()) as BrregRoller);
    },

    async searchCompanies(q, ctx) {
      const params = new URLSearchParams({ size: "20" });
      if (q.registrationNumber) params.set("organisasjonsnummer", q.registrationNumber.replace(/\s/g, ""));
      if (q.name) params.set("navn", q.name);
      const data = await http.json<{ _embedded?: { enheter?: BrregEnhet[] } }>(`${BASE}/enheter?${params}`, { signal: ctx?.signal });
      return (data._embedded?.enheter ?? []).map(normalizeBrregEnhet);
    },

    pollChanges: pollBrregChanges,
    feedIntervalSeconds: Number(process.env.NORWAY_FEED_POLL_SECONDS || 60),

    checkStatus: status_,
  };
}
