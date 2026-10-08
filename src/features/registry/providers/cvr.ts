import "server-only";
import { toDay, type Day } from "@/lib/dates/country-time";
import { createHttpClient } from "../http";
import { clean, cleanEmail, cleanPhone, cleanWebsite, joinStreet, titleCase } from "../normalize-helpers";
import type { CompanyRegistryProvider, FetchContext, NormalizedCompany, ProviderStatus } from "../types";

/**
 * DENMARK — CVR (Det Centrale Virksomhedsregister), Erhvervsstyrelsen
 * "system-til-system" Elasticsearch distribution. Official; access requires
 * credentials issued by the Danish Business Authority (email cvrselvbetjening@erst.dk).
 * Endpoint: POST http://distribution.virk.dk/cvr-permanent/virksomhed/_search (HTTP Basic auth)
 *
 * The register publishes phone/email/website when the company registered them.
 * Secret ("hemmelig") contact details are skipped. Companies with advertising
 * protection ("reklamebeskyttet") are flagged and excluded from outreach.
 *
 * Implemented against Erhvervsstyrelsen's published field documentation; verify
 * a first sync after credentials are issued.
 */
const BASE = (process.env.DENMARK_CVR_API_URL || "http://distribution.virk.dk/cvr-permanent").replace(/\/$/, "");
const USER = () => process.env.DENMARK_CVR_USERNAME || "";
const PASS = () => process.env.DENMARK_CVR_PASSWORD || "";
const http = createHttpClient({ name: "CVR (Erhvervsstyrelsen)", minIntervalMs: 500, timeoutMs: 30_000 });
const PAGE = 500;
const MAX_WINDOW = 3000; // from + size must stay ≤ 3000 on this cluster

type Period = { gyldigFra?: string | null; gyldigTil?: string | null };
type Kontakt = { kontaktoplysning?: string; hemmelig?: boolean; periode?: Period };
type Adresse = { vejnavn?: string; husnummerFra?: number; bogstavFra?: string; etage?: string; sidedoer?: string; postnummer?: number; postdistrikt?: string; conavn?: string; kommune?: { kommuneNavn?: string } };
export type CvrVirksomhed = {
  cvrNummer: number;
  reklamebeskyttet?: boolean;
  sidstOpdateret?: string;
  telefonNummer?: Kontakt[];
  elektroniskPost?: Kontakt[];
  hjemmeside?: Kontakt[];
  livsforloeb?: { periode?: Period }[];
  virksomhedMetadata?: {
    nyesteNavn?: { navn?: string };
    nyesteBeliggenhedsadresse?: Adresse;
    nyesteHovedbranche?: { branchekode?: string; branchetekst?: string };
    nyesteVirksomhedsform?: { virksomhedsformkode?: number; kortBeskrivelse?: string; langBeskrivelse?: string };
    sammensatStatus?: string;
    stiftelsesDato?: string;
  };
};

const current = (list?: Kontakt[]) => list?.find((k) => !k.hemmelig && !k.periode?.gyldigTil)?.kontaktoplysning;

export function sourceUrlFor(cvr: string | number) {
  return `https://datacvr.virk.dk/enhed/virksomhed/${cvr}`;
}

export function normalizeCvr(v: CvrVirksomhed): NormalizedCompany {
  const m = v.virksomhedMetadata ?? {};
  const a = m.nyesteBeliggenhedsadresse;
  const branche = m.nyesteHovedbranche;
  const started = m.stiftelsesDato ?? v.livsforloeb?.map((l) => l.periode?.gyldigFra).filter(Boolean).sort()[0] ?? undefined;
  const cvr = String(v.cvrNummer);
  return {
    identity: { sourceId: cvr, name: m.nyesteNavn?.navn ?? cvr, registrationNumber: cvr },
    registration: {
      registrationDay: toDay(started),
      incorporationDay: toDay(m.stiftelsesDato),
      status: m.sammensatStatus ? titleCase(m.sammensatStatus) : undefined,
      legalForm: m.nyesteVirksomhedsform?.langBeskrivelse ?? m.nyesteVirksomhedsform?.kortBeskrivelse,
      legalFormCode: m.nyesteVirksomhedsform?.kortBeskrivelse,
    },
    classification: {
      industryCode: branche?.branchekode,
      industryDescription: branche?.branchetekst,
      codeSystem: branche ? "DB07 (NACE Rev. 2)" : undefined,
      naceCode: branche?.branchekode && /^\d{4,6}$/.test(branche.branchekode) ? `${branche.branchekode.slice(0, 2)}.${branche.branchekode.slice(2, 4)}` : undefined,
    },
    contact: {
      email: cleanEmail(current(v.elektroniskPost)),
      phone: cleanPhone(current(v.telefonNummer), "DK"),
      website: cleanWebsite(current(v.hjemmeside)),
    },
    address: {
      business: a
        ? {
            street: [clean(a.conavn ? `c/o ${a.conavn}` : undefined), joinStreet([a.vejnavn, a.husnummerFra ? `${a.husnummerFra}${a.bogstavFra ?? ""}` : undefined, a.etage ? `${a.etage}.` : undefined, a.sidedoer])].filter(Boolean).join(", ") || undefined,
            postalCode: a.postnummer ? String(a.postnummer) : undefined,
            city: clean(a.postdistrikt),
            region: clean(a.kommune?.kommuneNavn ? titleCase(a.kommune.kommuneNavn) : undefined),
            country: "Denmark",
          }
        : undefined,
    },
    marketingProtected: v.reklamebeskyttet === true,
    source: { url: sourceUrlFor(cvr), updatedAt: v.sidstOpdateret ? new Date(v.sidstOpdateret) : undefined, raw: v },
  };
}

function authHeaders() {
  return { Authorization: `Basic ${Buffer.from(`${USER()}:${PASS()}`).toString("base64")}`, "Content-Type": "application/json" };
}

export function createCvrProvider(): CompanyRegistryProvider {
  return {
    id: "cvr",
    countryCode: "DK",
    name: "CVR — Erhvervsstyrelsen system-to-system access",
    sourceName: "CVR (Danish Business Authority)",
    sourceType: "OFFICIAL_REGISTRY",
    freshness: "REAL_TIME",
    isDemo: false,
    accessType: "API_KEY",
    registrationDateType: "CVR start date (livsforloeb / stiftelsesDato)",
    homepage: "https://datacvr.virk.dk",
    docsUrl: "https://erhvervsstyrelsen.dk/vejledning-adgang-til-cvr-data-system-til-system",
    description: "Official Danish business register. Requires CVR system-to-system credentials from Erhvervsstyrelsen.",
    limitations: "Companies with advertising protection (reklamebeskyttelse) are flagged and must not receive marketing.",
    capabilities: {
      supportsDailyRegistrations: true,
      supportsRealTimeSearch: true,
      supportsDailyUpdates: true,
      supportsRegistrationDate: true,
      supportsLookup: true,
      supportsEmail: true,
      supportsPhone: true,
      supportsMobile: false,
      supportsWebsite: true,
      supportsAddress: true,
      supportsIndustry: true,
      supportsDirectors: false,
      supportsRoles: false,
      supportsSourceUrl: true,
    },
    requiredEnv: ["DENMARK_CVR_USERNAME", "DENMARK_CVR_PASSWORD"],
    isConfigured: () => !!USER() && !!PASS(),
    recommendedSyncMinutes: 60,

    async getRegistrations(from: Day, to: Day, ctx: FetchContext) {
      const companies: NormalizedCompany[] = [];
      let total: number | undefined;
      for (let offset = 0; offset + PAGE <= MAX_WINDOW && companies.length < ctx.limit; offset += PAGE) {
        const body = {
          from: offset,
          size: PAGE,
          query: { range: { "Vrvirksomhed.livsforloeb.periode.gyldigFra": { gte: from, lte: to } } },
        };
        const data = await http.json<{ hits?: { total?: number; hits?: { _source?: { Vrvirksomhed?: CvrVirksomhed } }[] } }>(`${BASE}/virksomhed/_search`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify(body),
          signal: ctx.signal,
        });
        total = data.hits?.total ?? total;
        const hits = data.hits?.hits ?? [];
        for (const h of hits) {
          const v = h._source?.Vrvirksomhed;
          if (!v) continue;
          const n = normalizeCvr(v);
          // A company that re-started in the window keeps its original start date — exclude it.
          if (n.registration.registrationDay && n.registration.registrationDay >= from && n.registration.registrationDay <= to) companies.push(n);
        }
        ctx.log?.(`Fetched ${offset + hits.length}/${total ?? "?"}`);
        if (hits.length < PAGE) break;
      }
      return { companies: companies.slice(0, ctx.limit), total, complete: total === undefined || total <= MAX_WINDOW };
    },

    async getCompany(cvr, ctx) {
      const data = await http.json<{ hits?: { hits?: { _source?: { Vrvirksomhed?: CvrVirksomhed } }[] } }>(`${BASE}/virksomhed/_search`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ query: { term: { "Vrvirksomhed.cvrNummer": cvr.replace(/\D/g, "") } } }),
        signal: ctx?.signal,
      });
      const v = data.hits?.hits?.[0]?._source?.Vrvirksomhed;
      return v ? normalizeCvr(v) : null;
    },

    async checkStatus(): Promise<ProviderStatus> {
      if (!USER() || !PASS()) return { state: "CREDENTIALS_REQUIRED", message: "Set DENMARK_CVR_USERNAME and DENMARK_CVR_PASSWORD.", checkedAt: new Date() };
      try {
        const res = await http.request(`${BASE}/virksomhed/_search`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ size: 0, query: { match_all: {} } }) });
        await res.body?.cancel().catch(() => undefined);
        if (res.status === 401 || res.status === 403) return { state: "CREDENTIALS_REQUIRED", message: "The CVR credentials were rejected.", checkedAt: new Date() };
        return res.ok ? { state: "CONNECTED", checkedAt: new Date() } : { state: "UNAVAILABLE", message: `CVR responded ${res.status}`, checkedAt: new Date() };
      } catch (e) {
        return { state: "UNAVAILABLE", message: e instanceof Error ? e.message : String(e), checkedAt: new Date() };
      }
    },
  };
}
