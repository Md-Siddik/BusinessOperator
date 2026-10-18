import "server-only";
import { addDays, isDay, type Day } from "@/lib/dates/country-time";
import { createHttpClient, mapLimit } from "../http";
import { clean, titleCase } from "../normalize-helpers";
import type { CompanyRegistryProvider, FetchContext, NormalizedCompany, NormalizedPerson, ProviderStatus } from "../types";

/**
 * CZECHIA — ARES (Administrativní registr ekonomických subjektů), Ministry of Finance.
 * Public REST API, free, no key. Docs: https://ares.gov.cz/stranky/vyvojar-info
 *
 * ARES releases numbered notification batches (notifikační dávky) per source register.
 * For the public register ("vr": commercial, cooperative, foundation … registers) each batch
 * lists IČO numbers with a change type; INS = the entity was inserted. A sync window selects
 * batches by release date (datumUvolneniDavky) and reads each inserted entity's public-register
 * record, stored under its own registration date (datumZapisu — entry in the public register).
 * An INS whose datumZapisu is older than RECENT_DAYS before the batch is a re-inserted old
 * entity, not a new company, and is skipped.
 *
 * Commercial forms are imported by default; associations, foundations, unit-owner
 * associations and similar non-profits only with CZECHIA_INCLUDE_NON_PROFITS=true.
 * Statutory officers are kept as name + role only (no birth dates or home addresses).
 */
const BASE = (process.env.CZECHIA_ARES_API_URL || "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest").replace(/\/$/, "");
const http = createHttpClient({ name: "ARES (Czech Ministry of Finance)", minIntervalMs: 250, timeoutMs: 30_000 });
const includeNonProfits = () => process.env.CZECHIA_INCLUDE_NON_PROFITS === "true";
const RECENT_DAYS = 60;

/** Legal-form codes (ARES číselník PravniForma) for business entities. */
export const CZ_LEGAL_FORMS: Record<string, string> = {
  "111": "Veřejná obchodní společnost",
  "112": "Společnost s ručením omezeným",
  "113": "Komanditní společnost",
  "121": "Akciová společnost",
  "205": "Družstvo",
  "421": "Odštěpný závod zahraniční právnické osoby",
  "931": "Evropské hospodářské zájmové sdružení",
  "932": "Evropská společnost",
  "933": "Evropská družstevní společnost",
};
const BRANCH_FORMS = new Set(["421"]);

type Dated<T> = { datumZapisu?: string; datumVymazu?: string } & T;
type AresAddress = { textovaAdresa?: string; nazevUlice?: string; cisloDomovni?: number; cisloOrientacni?: number; nazevObce?: string; nazevCastiObce?: string; psc?: number | string; nazevKraje?: string };
type AresMember = Dated<{
  clenstvi?: { funkce?: { nazev?: string } };
  nazevAngazma?: string;
  fyzickaOsoba?: { jmeno?: string; prijmeni?: string; titulPredJmenem?: string; titulZaJmenem?: string };
  pravnickaOsoba?: { obchodniJmeno?: string };
}>;
export type AresVrRecord = Dated<{
  rejstrik?: string;
  primarniZaznam?: boolean;
  ico?: string;
  obchodniJmeno?: Dated<{ hodnota?: string }>[];
  pravniForma?: Dated<{ hodnota?: string }>[];
  adresy?: Dated<{ adresa?: AresAddress; typAdresy?: string }>[];
  stavSubjektu?: string;
  spisovaZnacka?: Dated<{ soud?: string; oddil?: string; vlozka?: number }>[];
  cinnosti?: { predmetPodnikani?: Dated<{ hodnota?: string }>[]; predmetCinnosti?: Dated<{ hodnota?: string }>[] };
  statutarniOrgany?: Dated<{ nazevOrganu?: string; clenoveOrganu?: AresMember[] }>[];
}>;

/** The value currently in force (no deletion date), newest entry first. */
function current<T extends Dated<object>>(items: T[] | undefined): T | undefined {
  return (items ?? []).filter((x) => !x.datumVymazu).sort((a, b) => (b.datumZapisu ?? "").localeCompare(a.datumZapisu ?? ""))[0];
}

/** Officers in force: name + role exactly as registered (surnames title-cased for display). */
export function aresPeople(r: AresVrRecord): NormalizedPerson[] {
  const out: NormalizedPerson[] = [];
  for (const organ of (r.statutarniOrgany ?? []).filter((o) => !o.datumVymazu)) {
    for (const m of (organ.clenoveOrganu ?? []).filter((x) => !x.datumVymazu)) {
      const f = m.fyzickaOsoba;
      const name = f ? clean([f.titulPredJmenem, titleCase(clean(f.jmeno)), titleCase(clean(f.prijmeni)), f.titulZaJmenem].filter(Boolean).join(" ")) : clean(m.pravnickaOsoba?.obchodniJmeno);
      const role = clean(m.clenstvi?.funkce?.nazev) ?? clean(m.nazevAngazma) ?? clean(organ.nazevOrganu);
      if (name && role) out.push({ name, role, group: clean(organ.nazevOrganu) ?? "Statutory body" });
    }
  }
  return out.slice(0, 10);
}

/** Normalize one public-register record; null when it is not an importable business entity. */
export function normalizeAres(ico: string, r: AresVrRecord | undefined): NormalizedCompany | null {
  if (!r) return null;
  const name = clean(current(r.obchodniJmeno)?.hodnota);
  const formCode = clean(current(r.pravniForma)?.hodnota);
  const day = clean(r.datumZapisu);
  if (!name || !day || !isDay(day)) return null;
  if (!includeNonProfits() && !(formCode && CZ_LEGAL_FORMS[formCode])) return null;
  const seat = (r.adresy ?? []).filter((a) => !a.datumVymazu && a.typAdresy === "SIDLO").sort((a, b) => (b.datumZapisu ?? "").localeCompare(a.datumZapisu ?? ""))[0]?.adresa;
  const house = seat?.cisloDomovni ? `${seat.cisloDomovni}${seat.cisloOrientacni ? `/${seat.cisloOrientacni}` : ""}` : undefined;
  const street = seat?.nazevUlice ? `${seat.nazevUlice}${house ? ` ${house}` : ""}` : house ? `${seat?.nazevCastiObce ? `${seat.nazevCastiObce} ` : ""}č.p. ${house}` : undefined;
  const people = aresPeople(r);
  const activity = current(r.cinnosti?.predmetPodnikani)?.hodnota ?? current(r.cinnosti?.predmetCinnosti)?.hodnota;
  const file = current(r.spisovaZnacka);
  return {
    identity: { sourceId: ico, name, registrationNumber: ico },
    registration: {
      registrationDay: day,
      status: r.stavSubjektu === "AKTIVNI" ? "Active" : clean(r.stavSubjektu),
      legalForm: formCode ? (CZ_LEGAL_FORMS[formCode] ?? `Legal form ${formCode}`) : undefined,
      legalFormCode: formCode,
    },
    classification: { businessActivity: clean(activity?.replace(/\s+/g, " "))?.slice(0, 1000) },
    contact: {},
    address: { business: seat ? { street, postalCode: seat.psc ? String(seat.psc) : undefined, city: clean(seat.nazevObce), region: clean(seat.nazevKraje), country: "Czechia" } : undefined },
    people: people.length ? people : undefined,
    contactPerson: people[0],
    eventType: formCode && BRANCH_FORMS.has(formCode) ? "BRANCH" : "NEW_ENTITY",
    source: {
      url: `https://ares.gov.cz/ekonomicke-subjekty?ico=${ico}`,
      raw: { ico, rejstrik: r.rejstrik, spisovaZnacka: file ? `${file.oddil ?? ""} ${file.vlozka ?? ""}/${file.soud ?? ""}`.trim() : undefined, datumZapisu: day, pravniForma: formCode },
    },
  };
}

type Batch = { cisloDavky: number; datumUvolneniDavky?: string; pocetZmen?: number };

async function listBatches(signal?: AbortSignal) {
  const data = await http.json<{ notifikacniDavky?: Batch[] }>(`${BASE}/ekonomicke-subjekty-notifikace/vyhledat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ datovyZdroj: "vr" }),
    signal,
  });
  return data.notifikacniDavky ?? [];
}

async function insertedIcos(batch: number, signal?: AbortSignal) {
  const data = await http.json<{ seznamNotifikaci?: { typZmeny?: string; icoId?: string }[] }>(`${BASE}/ekonomicke-subjekty-notifikace/datovy-zdroj/vr/cislo-davky/${batch}`, { signal });
  return (data.seznamNotifikaci ?? []).filter((n) => n.typZmeny === "INS" && /^\d{8}$/.test(n.icoId ?? "")).map((n) => n.icoId!);
}

/** The primary public-register record for one IČO; null when ARES has none (404). */
async function vrRecord(ico: string, signal?: AbortSignal): Promise<AresVrRecord | null> {
  const res = await http.request(`${BASE}/ekonomicke-subjekty-vr/${ico}`, { signal, headers: { Accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`ARES responded ${res.status} for IČO ${ico}`);
  const data = (await res.json()) as { zaznamy?: AresVrRecord[] };
  const z = data.zaznamy ?? [];
  return z.find((x) => x.primarniZaznam) ?? z[0] ?? null;
}

export function createAresCzProvider(): CompanyRegistryProvider {
  return {
    id: "ares-cz",
    countryCode: "CZ",
    name: "ARES — public register new entries (notification batches)",
    sourceName: "ARES (Ministry of Finance of the Czech Republic)",
    sourceType: "OFFICIAL_REGISTRY",
    freshness: "DAILY",
    isDemo: false,
    accessType: "OPEN",
    registrationDateType: "Date of entry in the public register (datum zápisu); ARES releases it in a notification batch 1–3 days later",
    homepage: "https://ares.gov.cz",
    docsUrl: "https://ares.gov.cz/swagger-ui/",
    description: "New entries in the Czech public register (s.r.o., a.s., cooperatives …) from ARES notification batches. Public API, no key.",
    limitations:
      "ARES releases batches one to a few days after the court registers the entity, so today's count fills in over the next days. No industry code, email, phone or website for new entities. Associations, foundations and other non-profits are excluded by default.",
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
      supportsIndustry: false,
      supportsDirectors: true,
      supportsRoles: true,
      supportsSourceUrl: true,
    },
    requiredEnv: [],
    isConfigured: () => true,
    recommendedSyncMinutes: 3 * 60,
    windowBy: "publication",

    /** Entities inserted in batches RELEASED from `from` to `to`, each under its own registration date. */
    async getRegistrations(from: Day, to: Day, ctx: FetchContext) {
      if (!isDay(from) || !isDay(to)) throw new Error("Invalid date");
      const batches = (await listBatches(ctx.signal)).filter((b) => b.datumUvolneniDavky && b.datumUvolneniDavky >= from && b.datumUvolneniDavky <= to);
      const items: { ico: string; released: Day }[] = [];
      for (const b of batches) for (const ico of await insertedIcos(b.cisloDavky, ctx.signal)) items.push({ ico, released: b.datumUvolneniDavky! });
      const unique = [...new Map(items.map((i) => [i.ico, i])).values()];
      const total = unique.length;
      ctx.log?.(`ARES: ${batches.length} batch(es), ${total} inserted entities; reading records…`);
      let failed = 0;
      let done = 0;
      const results = await mapLimit(unique.slice(0, ctx.limit), 3, async ({ ico, released }) => {
        try {
          const n = normalizeAres(ico, (await vrRecord(ico, ctx.signal)) ?? undefined);
          if (++done % 50 === 0) ctx.log?.(`Read ${done}/${Math.min(total, ctx.limit)} records`);
          // A re-inserted old entity is not a new registration.
          if (!n || n.registration.registrationDay! < addDays(released, -RECENT_DAYS)) return null;
          n.source.publishedAt = new Date(`${released}T00:00:00Z`);
          return n;
        } catch (e) {
          failed++;
          ctx.log?.(`IČO ${ico} could not be read: ${e instanceof Error ? e.message : String(e)}`);
          return null;
        }
      });
      if (failed && failed > Math.max(3, total * 0.1)) throw new Error(`ARES: ${failed} of ${total} records could not be read.`);
      const companies = results.filter((c): c is NormalizedCompany => !!c);
      return { companies, total, complete: !failed && total <= ctx.limit };
    },

    async getCompany(registrationNumber: string, ctx?: Pick<FetchContext, "signal">) {
      const ico = registrationNumber.replace(/\D/g, "").padStart(8, "0");
      if (!/^\d{8}$/.test(ico)) return null;
      return normalizeAres(ico, (await vrRecord(ico, ctx?.signal)) ?? undefined);
    },

    async getLatestPublication() {
      const released = (await listBatches()).map((b) => b.datumUvolneniDavky).filter((d): d is string => !!d && isDay(d)).sort();
      const last = released[released.length - 1];
      return last ? new Date(`${last}T00:00:00Z`) : null;
    },

    async checkStatus(): Promise<ProviderStatus> {
      try {
        await listBatches();
        return { state: "CONNECTED", checkedAt: new Date() };
      } catch (e) {
        return { state: "UNAVAILABLE", message: e instanceof Error ? e.message : String(e), checkedAt: new Date() };
      }
    },
  };
}
