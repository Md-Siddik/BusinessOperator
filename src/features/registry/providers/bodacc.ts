import "server-only";
import { eachDay, isDay, type Day } from "@/lib/dates/country-time";
import { createHttpClient } from "../http";
import { clean, joinStreet, titleCase } from "../normalize-helpers";
import type { CompanyRegistryProvider, FetchContext, NormalizedCompany, NormalizedPerson, ProviderStatus } from "../types";

/**
 * FRANCE — BODACC A "Créations" (Bulletin officiel des annonces civiles et commerciales),
 * published by the DILA (Direction de l'information légale et administrative) as open data
 * on its Opendatasoft portal. Free, no account or key; Licence Ouverte / Etalab 2.0.
 * Docs: https://bodacc-datadila.opendatasoft.com/explore/dataset/annonces-commerciales/api/
 *
 * Every new RCS registration is announced in BODACC A a few days after the greffe registers
 * it. A sync window selects notices by publication date (dateparution) and stores each
 * company under its real RCS registration date (acte.dateImmatriculation). Notices that do
 * not state an immatriculation date are skipped — the publication date is never used as a
 * stand-in for a registration date.
 *
 * Only legal persons (typePersonne "pm") are imported by default; sole traders (personnes
 * physiques) are natural persons and are included only with FRANCE_INCLUDE_SOLE_TRADERS=true.
 * The notice lists the company's officers ("Président : …", "Gérant : …"): their names and
 * roles are kept as published; nothing else about them is stored.
 */
const BASE = (process.env.FRANCE_BODACC_API_URL || "https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales").replace(/\/$/, "");
const http = createHttpClient({ name: "BODACC (DILA open data)", minIntervalMs: 300, timeoutMs: 30_000 });
const includeSoleTraders = () => process.env.FRANCE_INCLUDE_SOLE_TRADERS === "true";
/** Opendatasoft serves at most 100 records per request and offset + limit ≤ 10 000. */
const PAGE = 100;
const MAX_OFFSET = 10_000;

type BodaccAddress = { numeroVoie?: string; typeVoie?: string; nomVoie?: string; complGeographique?: string; codePostal?: string; ville?: string };
type BodaccPersonne = {
  typePersonne?: string;
  numeroImmatriculation?: { numeroIdentification?: string; codeRCS?: string; nomGreffeImmat?: string };
  denomination?: string;
  nom?: string;
  prenom?: string;
  formeJuridique?: string;
  administration?: string;
  adresseSiegeSocial?: BodaccAddress;
};
type BodaccEtablissement = { activite?: string; qualiteEtablissement?: string; adresse?: BodaccAddress };
export type BodaccRecord = {
  id: string;
  dateparution?: string;
  typeavis?: string;
  familleavis?: string;
  commercant?: string;
  ville?: string;
  cp?: string;
  registre?: string[];
  tribunal?: string;
  departement_nom_officiel?: string;
  listepersonnes?: string | null;
  listeetablissements?: string | null;
  acte?: string | null;
  url_complete?: string;
};

function parseJson<T>(value: string | null | undefined): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

const first = <T,>(v: T | T[] | undefined): T | undefined => (Array.isArray(v) ? v[0] : v);
const list = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/**
 * "Président : TROLENKO Igor nom d'usage : TROLENKO. Directeur général : SIURA Darja" →
 * [{ role: "Président", name: "Igor Trolenko" … }]. Names are kept exactly as published,
 * only the upper-case surname is title-cased for display.
 */
export function parseAdministration(text: string | undefined): NormalizedPerson[] {
  if (!text) return [];
  const out: NormalizedPerson[] = [];
  // Entries are separated by ";" or ". " — and inside one segment by ", <Role> :".
  const segments = text.replace(/\s*nom d'usage\s*:\s*[^.;,]+/gi, "").split(/\s*;\s*|\.\s+(?=\p{Lu})/u);
  for (const segment of segments) {
    const colons = [...segment.matchAll(/\s*:\s*/g)];
    let roleStart = 0;
    for (let i = 0; i < colons.length; i++) {
      const colon = colons[i]!;
      const role = clean(segment.slice(roleStart, colon.index).replace(/^,\s*/, ""));
      const valueStart = colon.index! + colon[0].length;
      const next = colons[i + 1];
      let valueEnd = segment.length;
      if (next) {
        // The next role begins after the last ", " before the next colon.
        const between = segment.slice(valueStart, next.index);
        const cut = between.lastIndexOf(", ");
        valueEnd = cut >= 0 ? valueStart + cut : valueStart;
        roleStart = cut >= 0 ? valueStart + cut + 2 : next.index!;
      }
      const name = officerName(clean(segment.slice(valueStart, valueEnd).replace(/[.,]\s*$/, "")));
      if (role && name && role.length <= 90) out.push({ name: name.value, role, group: name.company ? "Corporate officer" : "Management" });
    }
  }
  return out.slice(0, 10);
}

const CORPORATE = /\b(société|societe|sas|sasu|sarl|eurl|sa|sci|scp|selarl|holding|capital|partners|invest\w*|gestion|groupe?|conseil|audit|expertise|finance|associés|management|consulting|immobili\w*|patrimoine|ltd|gmbh|llc|inc)\b/i;

/**
 * Officer name as published. "LUX, Jérémy" → "Jérémy Lux"; "TROLENKO Igor" → "Trolenko Igor".
 * Legal persons (upper-case only, or with a corporate word) stay untouched and are flagged.
 */
function officerName(raw: string | undefined): { value: string; company: boolean } | undefined {
  if (!raw || raw.length < 2) return undefined;
  const comma = /^([\p{Lu}'’ -]{2,}),\s*(.+)$/u.exec(raw);
  // Further comma-separated words are additional given names ("PAILLERON Quentin, Michel, Jean").
  if (comma && !CORPORATE.test(raw)) return { value: `${comma[2]!.split(",")[0]!.trim()} ${titleCase(comma[1]!.trim())}`, company: false };
  if (raw === raw.toUpperCase() || CORPORATE.test(raw)) return { value: raw, company: true };
  return { value: raw.split(",")[0]!.trim().replace(/\p{Lu}[\p{Lu}'’-]+/gu, (w) => titleCase(w) ?? w), company: false };
}

/** Officers who represent the company — the first is the contact person the notice names. */
const REPRESENTATIVE = /^(président|presidente?|gérant|gerant|directeur général|directeur general|co-?gérant|administrateur|associé gérant)/i;

export function categoryEvent(category: string | undefined) {
  if (!category) return "NEW_ENTITY";
  if (/transfert/i.test(category)) return "RELOCATION";
  if (/achat|reprise|apport|location-g[ée]rance|g[ée]rance-mandat/i.test(category)) return "CONTINUATION";
  return "NEW_ENTITY";
}

function address(a: BodaccAddress | undefined) {
  if (!a) return undefined;
  return { street: joinStreet([a.numeroVoie, a.typeVoie, a.nomVoie]) ?? clean(a.complGeographique), postalCode: clean(a.codePostal), city: clean(a.ville) };
}

/** Normalize one BODACC creation notice. Null when it is not a usable new-company record. */
export function normalizeBodacc(r: BodaccRecord): NormalizedCompany | null {
  const personnes = list(parseJson<{ personne?: BodaccPersonne | BodaccPersonne[] }>(r.listepersonnes)?.personne);
  const p = personnes.find((x) => x.typePersonne === "pm") ?? (includeSoleTraders() ? personnes[0] : undefined);
  if (!p) return null;
  const acte = parseJson<{ dateImmatriculation?: string; creation?: { categorieCreation?: string } }>(r.acte) ?? {};
  const day = clean(acte.dateImmatriculation);
  if (!day || !isDay(day)) return null;
  const siren = (clean(p.numeroImmatriculation?.numeroIdentification) ?? clean(r.registre?.[0]))?.replace(/\s/g, "");
  const name = clean(p.denomination) ?? clean([p.prenom, p.nom].filter(Boolean).join(" ")) ?? clean(r.commercant);
  if (!siren || !/^\d{9}$/.test(siren) || !name) return null;
  const etab = list(parseJson<{ etablissement?: BodaccEtablissement | BodaccEtablissement[] }>(r.listeetablissements)?.etablissement);
  const seat = address(p.adresseSiegeSocial) ?? address(first(etab)?.adresse) ?? { postalCode: clean(r.cp), city: clean(r.ville) };
  const people = parseAdministration(p.administration);
  const pub = clean(r.dateparution);
  return {
    identity: { sourceId: siren, name, registrationNumber: siren },
    registration: { registrationDay: day, status: "Registered", legalForm: clean(p.formeJuridique) },
    classification: { businessActivity: clean(etab.map((e) => e.activite).find(Boolean))?.slice(0, 1000) },
    contact: {},
    address: { business: { ...seat, region: clean(r.departement_nom_officiel), country: "France" } },
    people: people.length ? people : undefined,
    // Contact person: a natural person who represents the company — never a corporate officer.
    contactPerson: people.find((x) => x.group === "Management" && REPRESENTATIVE.test(x.role)) ?? people.find((x) => x.group === "Management"),
    eventType: categoryEvent(acte.creation?.categorieCreation),
    source: { url: r.url_complete, publishedAt: pub && isDay(pub) ? new Date(`${pub}T00:00:00Z`) : undefined, raw: r },
  };
}

function whereFor(day: Day) {
  const parts = [`familleavis="creation"`, `dateparution=date'${day}'`, `typeavis!="annulation"`];
  if (!includeSoleTraders()) parts.push(`listepersonnes like "*\\"pm\\"*"`);
  return parts.join(" and ");
}

/** All creation notices published on one day (stable order by notice id). */
async function noticesFor(day: Day, ctx: FetchContext, room: number) {
  const records: BodaccRecord[] = [];
  let total = 0;
  for (let offset = 0; offset < MAX_OFFSET && records.length < room; offset += PAGE) {
    const q = new URLSearchParams({ where: whereFor(day), order_by: "id", limit: String(PAGE), offset: String(offset) });
    const data = await http.json<{ total_count?: number; results?: BodaccRecord[] }>(`${BASE}/records?${q}`, { signal: ctx.signal });
    total = data.total_count ?? 0;
    const page = data.results ?? [];
    records.push(...page);
    if (page.length < PAGE || offset + PAGE >= total) break;
  }
  return { records, total };
}

export function createBodaccProvider(): CompanyRegistryProvider {
  return {
    id: "bodacc",
    countryCode: "FR",
    name: "BODACC A — new company registrations (DILA open data)",
    sourceName: "BODACC (DILA)",
    sourceType: "OFFICIAL_OPEN_DATA",
    freshness: "DAILY",
    isDemo: false,
    accessType: "OPEN",
    registrationDateType: "RCS registration date (date d'immatriculation) stated in the BODACC notice; published a few days later",
    homepage: "https://www.bodacc.fr",
    docsUrl: "https://bodacc-datadila.opendatasoft.com/explore/dataset/annonces-commerciales/information/",
    description: "Official BODACC announcements of new RCS registrations, from the DILA open-data portal. Free, no key (Licence Ouverte 2.0).",
    limitations:
      "BODACC publishes each registration a few days after the greffe records it, so today's count fills in over the next days. Notices without an immatriculation date are skipped. No industry code (NAF), email, phone or website. Sole traders are excluded by default.",
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
      supportsDirectors: true,
      supportsRoles: true,
      supportsSourceUrl: true,
    },
    requiredEnv: [],
    isConfigured: () => true,
    recommendedSyncMinutes: 3 * 60,
    windowBy: "publication",

    /** Notices PUBLISHED from `from` to `to`, each stored under its RCS registration date. */
    async getRegistrations(from: Day, to: Day, ctx: FetchContext) {
      if (!isDay(from) || !isDay(to)) throw new Error("Invalid date");
      const companies: NormalizedCompany[] = [];
      let total = 0;
      let fetched = 0;
      let skipped = 0;
      for (const day of eachDay(from, to)) {
        const r = await noticesFor(day, ctx, ctx.limit - fetched);
        total += r.total;
        fetched += r.records.length;
        for (const rec of r.records) {
          const n = normalizeBodacc(rec);
          if (n) companies.push(n);
          else skipped++;
        }
        if (fetched >= ctx.limit) break;
      }
      ctx.log?.(`BODACC: ${fetched} creation notices read, ${companies.length} new companies, ${skipped} skipped (no immatriculation date / not a legal person).`);
      return { companies, total, complete: fetched >= total };
    },

    async getLatestPublication() {
      const q = new URLSearchParams({ where: `familleavis="creation"`, order_by: "dateparution desc", limit: "1", select: "dateparution" });
      const data = await http.json<{ results?: { dateparution?: string }[] }>(`${BASE}/records?${q}`);
      const d = data.results?.[0]?.dateparution;
      return d ? new Date(`${d}T00:00:00Z`) : null;
    },

    async checkStatus(): Promise<ProviderStatus> {
      try {
        await http.json(`${BASE}/records?${new URLSearchParams({ where: `familleavis="creation"`, limit: "0" })}`);
        return { state: "CONNECTED", checkedAt: new Date() };
      } catch (e) {
        return { state: "UNAVAILABLE", message: e instanceof Error ? e.message : String(e), checkedAt: new Date() };
      }
    },
  };
}
