import "server-only";
import { toDay, type Day } from "@/lib/dates/country-time";
import { createHttpClient } from "../http";
import { clean, joinStreet, titleCase } from "../normalize-helpers";
import type { CompanyRegistryProvider, FetchContext, NormalizedCompany, ProviderStatus } from "../types";

/**
 * FRANCE — INSEE Sirene API 3.11 (official business register, updated daily).
 * Requires a free API key from the INSEE API portal: https://portail-api.insee.fr/
 * Auth header: X-INSEE-Api-Key-Integration. Rate limit: 30 requests / minute.
 *
 * Daily view: GET /siret?q=dateCreationUniteLegale:[D TO D] AND etablissementSiege:true&nombre=1000&curseur=*
 * (head office of each legal unit, cursor pagination).
 *
 * Note: `dateCreationUniteLegale` is the legal creation date; units can appear in
 * Sirene a few days after that date, so "today" fills in over the following days.
 * Units with partial diffusion (statut "P" — the person opted out) are skipped.
 * Sole traders (catégorie juridique 1000, natural persons) are skipped unless
 * FRANCE_INCLUDE_SOLE_TRADERS=true.
 */
const BASE = (process.env.FRANCE_SIRENE_API_URL || "https://api.insee.fr/api-sirene/3.11").replace(/\/$/, "");
const KEY = () => process.env.FRANCE_SIRENE_API_KEY || "";
const http = createHttpClient({ name: "INSEE Sirene", minIntervalMs: 2_100, timeoutMs: 30_000 });
const headers = () => ({ "X-INSEE-Api-Key-Integration": KEY() });

const LEGAL_FORMS: Record<string, string> = {
  "1000": "Entrepreneur individuel",
  "5498": "SARL unipersonnelle (EURL)",
  "5499": "Société à responsabilité limitée (SARL)",
  "5710": "Société par actions simplifiée (SAS)",
  "5720": "SAS à associé unique (SASU)",
  "6540": "Société civile immobilière (SCI)",
  "9220": "Association déclarée",
};

export type SireneEtablissement = {
  siren: string;
  siret: string;
  dateDernierTraitementEtablissement?: string;
  uniteLegale?: {
    denominationUniteLegale?: string | null;
    denominationUsuelle1UniteLegale?: string | null;
    sigleUniteLegale?: string | null;
    nomUniteLegale?: string | null;
    prenom1UniteLegale?: string | null;
    categorieJuridiqueUniteLegale?: string | null;
    activitePrincipaleUniteLegale?: string | null;
    nomenclatureActivitePrincipaleUniteLegale?: string | null;
    dateCreationUniteLegale?: string | null;
    etatAdministratifUniteLegale?: string | null;
    statutDiffusionUniteLegale?: string | null;
  };
  adresseEtablissement?: {
    complementAdresseEtablissement?: string | null;
    numeroVoieEtablissement?: string | null;
    indiceRepetitionEtablissement?: string | null;
    typeVoieEtablissement?: string | null;
    libelleVoieEtablissement?: string | null;
    codePostalEtablissement?: string | null;
    libelleCommuneEtablissement?: string | null;
  };
};

export function sourceUrlFor(siren: string) {
  return `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}`;
}

export function normalizeSirene(e: SireneEtablissement): NormalizedCompany {
  const u = e.uniteLegale ?? {};
  const a = e.adresseEtablissement ?? {};
  const person = [u.prenom1UniteLegale, u.nomUniteLegale].filter(Boolean).join(" ");
  const name = clean(u.denominationUniteLegale ?? undefined) ?? clean(u.denominationUsuelle1UniteLegale ?? undefined) ?? clean(person) ?? e.siren;
  const naf = u.activitePrincipaleUniteLegale ?? undefined;
  const cj = u.categorieJuridiqueUniteLegale ?? undefined;
  return {
    identity: { sourceId: e.siren, name, registrationNumber: e.siren },
    registration: {
      registrationDay: toDay(u.dateCreationUniteLegale),
      incorporationDay: toDay(u.dateCreationUniteLegale),
      status: u.etatAdministratifUniteLegale === "A" ? "Active" : u.etatAdministratifUniteLegale === "C" ? "Ceased" : undefined,
      legalForm: cj ? (LEGAL_FORMS[cj] ?? `Catégorie juridique ${cj}`) : undefined,
      legalFormCode: cj,
    },
    classification: {
      industryCode: naf,
      codeSystem: naf ? (u.nomenclatureActivitePrincipaleUniteLegale ?? "NAF") : undefined,
      naceCode: naf && /^\d{2}\.\d{2}/.test(naf) ? naf.slice(0, 5) : undefined,
    },
    contact: {},
    address: {
      business: {
        street: [clean(a.complementAdresseEtablissement ?? undefined), joinStreet([a.numeroVoieEtablissement, a.indiceRepetitionEtablissement, a.typeVoieEtablissement, a.libelleVoieEtablissement])].filter(Boolean).join(", ") || undefined,
        postalCode: clean(a.codePostalEtablissement ?? undefined),
        city: titleCase(clean(a.libelleCommuneEtablissement ?? undefined)),
        country: "France",
      },
    },
    source: { url: sourceUrlFor(e.siren), updatedAt: e.dateDernierTraitementEtablissement ? new Date(e.dateDernierTraitementEtablissement) : undefined, raw: e },
  };
}

export function isPublishable(e: SireneEtablissement) {
  const u = e.uniteLegale ?? {};
  if (u.statutDiffusionUniteLegale && u.statutDiffusionUniteLegale !== "O") return false;
  if (u.categorieJuridiqueUniteLegale === "1000" && process.env.FRANCE_INCLUDE_SOLE_TRADERS !== "true") return false;
  return true;
}

export function createInseeSireneProvider(): CompanyRegistryProvider {
  return {
    id: "insee-sirene",
    countryCode: "FR",
    name: "INSEE — API Sirene 3.11",
    sourceName: "INSEE Sirene",
    sourceType: "OFFICIAL_REGISTRY",
    freshness: "DAILY",
    isDemo: false,
    accessType: "API_KEY",
    registrationDateType: "Legal unit creation date (dateCreationUniteLegale)",
    homepage: "https://www.sirene.fr",
    docsUrl: "https://portail-api.insee.fr/",
    description: "Official French business register (Sirene), updated daily. Free API key required.",
    limitations: "Sirene does not publish email addresses, phone numbers or websites. New units can appear a few days after their creation date.",
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
      supportsSourceUrl: true,
    },
    requiredEnv: ["FRANCE_SIRENE_API_KEY"],
    isConfigured: () => !!KEY(),
    recommendedSyncMinutes: 24 * 60,

    async getRegistrations(from: Day, to: Day, ctx: FetchContext) {
      const companies: NormalizedCompany[] = [];
      const q = `dateCreationUniteLegale:[${from} TO ${to}] AND etablissementSiege:true`;
      let cursor = "*";
      let total: number | undefined;
      let seen = 0;
      for (let i = 0; i < 100 && companies.length < ctx.limit; i++) {
        const url = `${BASE}/siret?q=${encodeURIComponent(q)}&nombre=1000&curseur=${encodeURIComponent(cursor)}`;
        const res = await http.request(url, { headers: headers(), signal: ctx.signal });
        if (res.status === 404) break; // Sirene answers 404 when nothing matches
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) throw new Error("INSEE rejected the API key. Check FRANCE_SIRENE_API_KEY.");
          throw new Error(`INSEE Sirene responded ${res.status}`);
        }
        const data = (await res.json()) as { header?: { total?: number; curseurSuivant?: string; curseur?: string }; etablissements?: SireneEtablissement[] };
        total = data.header?.total ?? total;
        const items = data.etablissements ?? [];
        seen += items.length;
        companies.push(...items.filter(isPublishable).map(normalizeSirene));
        ctx.log?.(`Fetched ${seen}/${total ?? "?"} (${companies.length} kept)`);
        const next = data.header?.curseurSuivant;
        if (!items.length || !next || next === cursor) break;
        cursor = next;
      }
      return { companies: companies.slice(0, ctx.limit), total, complete: total === undefined || seen >= total };
    },

    async getCompany(siren, ctx) {
      const q = `siren:${siren.replace(/\s/g, "")} AND etablissementSiege:true`;
      const res = await http.request(`${BASE}/siret?q=${encodeURIComponent(q)}&nombre=1`, { headers: headers(), signal: ctx?.signal });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`INSEE Sirene responded ${res.status}`);
      const e = ((await res.json()) as { etablissements?: SireneEtablissement[] }).etablissements?.[0];
      return e && isPublishable(e) ? normalizeSirene(e) : null;
    },

    async checkStatus(): Promise<ProviderStatus> {
      if (!KEY()) return { state: "CREDENTIALS_REQUIRED", message: "Set FRANCE_SIRENE_API_KEY.", checkedAt: new Date() };
      try {
        const res = await http.request(`${BASE}/informations`, { headers: headers() });
        await res.body?.cancel().catch(() => undefined);
        if (res.status === 401 || res.status === 403) return { state: "CREDENTIALS_REQUIRED", message: "The API key was rejected.", checkedAt: new Date() };
        return res.ok ? { state: "CONNECTED", checkedAt: new Date() } : { state: "UNAVAILABLE", message: `API responded ${res.status}`, checkedAt: new Date() };
      } catch (e) {
        return { state: "UNAVAILABLE", message: e instanceof Error ? e.message : String(e), checkedAt: new Date() };
      }
    },
  };
}
