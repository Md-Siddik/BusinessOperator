import "server-only";
import { toDay, todayIn, type Day } from "@/lib/dates/country-time";
import { createHttpClient, ProviderHttpError } from "../http";
import { clean, titleCase } from "../normalize-helpers";
import type { ChangeBatch, CompanyRegistryProvider, FetchContext, NormalizedCompany, ProviderStatus } from "../types";

/**
 * NETHERLANDS — KVK Mutatieservice (subscription signals) + Basisprofiel API.
 * Contract taken from KVK's published OpenAPI spec (api-kms.yaml):
 *   GET /v1/abonnementen                                   — subscriptions
 *   GET /v1/abonnementen/{id}?vanaf&tot&pagina&aantal       — signal list (RFC3339 vanaf/tot, aantal 10–500)
 *   GET /v1/abonnementen/{id}/signalen/{signaalId}          — signal detail
 *   GET /v1/basisprofielen/{kvkNummer}                      — name, trade names, SBI, address, indNonMailing
 * Header: apikey. KVK documents signal delivery within 15 minutes → NEAR_REAL_TIME.
 *
 * A new registration is SignaalNieuweInschrijving; heeftNieuweGegevens.aanleiding.code
 * distinguishes a new formation ("NW") from other reasons — other reasons are stored
 * as non-new events and kept out of new-company counts. Signals carry no email/phone.
 * The KVK test environment (api.kvk.nl/test/api) serves fictional data and is refused in production.
 */
const BASE = (process.env.NL_KVK_API_URL || "https://api.kvk.nl/api").replace(/\/$/, "");
const KEY = () => process.env.NL_KVK_API_KEY || "";
const isTestEnv = () => BASE.includes("/test/");
const http = createHttpClient({ name: "KVK", minIntervalMs: 250, timeoutMs: 20_000 });

type SignalInfo = { id: string; timestamp: string; kvknummer: string; signaalType: string; vestigingsnummer?: string };
type SignalDetail = {
  signaal: {
    signaalType: string;
    registratieTijdstip: string;
    heeftBetrekkingOp: { kvkNummer: string; nonMailing?: boolean; heeftAlsEigenaar?: { rechtspersoon?: { persoonRechtsvorm?: string }; natuurlijkPersoon?: { persoonRechtsvorm?: string } } };
    heeftNieuweGegevens?: { aanleiding?: { code: string; omschrijving: string }; startdatum?: string; kvkNummer?: string };
  };
};
export type KvkBasisprofiel = {
  kvkNummer: string;
  naam?: string;
  indNonMailing?: string;
  handelsnamen?: { naam: string; volgorde: number }[];
  sbiActiviteiten?: { sbiCode: string; sbiOmschrijving: string; indHoofdactiviteit?: string }[];
  materieleRegistratie?: { datumAanvang?: string; datumEinde?: string };
  _embedded?: {
    eigenaar?: { rechtsvorm?: string; uitgebreideRechtsvorm?: string };
    hoofdvestiging?: { adressen?: { type: string; indAfgeschermd?: string; volledigAdres?: string; straatnaam?: string; huisnummer?: number; huisletter?: string; postcode?: string; plaats?: string; land?: string }[] };
  };
};

async function get<T>(path: string, signal?: AbortSignal) {
  if (process.env.NODE_ENV === "production" && isTestEnv()) throw new ProviderHttpError("The KVK test environment serves fictional data and cannot be used in production.");
  const res = await http.request(`${BASE}${path}`, { headers: { apikey: KEY() }, signal });
  if (res.status === 401 || res.status === 403) throw new ProviderHttpError("KVK rejected the API key", res.status);
  if (res.status === 404) return null;
  if (!res.ok) throw new ProviderHttpError(`KVK responded ${res.status}`, res.status, true);
  return (await res.json()) as T;
}

async function subscriptionId(signal?: AbortSignal) {
  if (process.env.NL_KVK_SUBSCRIPTION_ID) return process.env.NL_KVK_SUBSCRIPTION_ID;
  const data = await get<{ abonnementen?: { id: string; actief?: boolean }[] }>("/v1/abonnementen", signal);
  const sub = data?.abonnementen?.find((a) => a.actief) ?? data?.abonnementen?.[0];
  if (!sub) throw new ProviderHttpError("No active KVK Mutatieservice subscription found for this API key.");
  return sub.id;
}

/** Map a Basisprofiel (+ signal context) to the normalized company. Exported for tests. */
export function normalizeKvk(profile: KvkBasisprofiel, signal?: SignalDetail["signaal"]): NormalizedCompany {
  const addr = profile._embedded?.hoofdvestiging?.adressen?.find((a) => a.type === "bezoekadres") ?? profile._embedded?.hoofdvestiging?.adressen?.[0];
  const shielded = addr?.indAfgeschermd === "Ja";
  const main = profile.sbiActiviteiten?.find((a) => a.indHoofdactiviteit === "Ja") ?? profile.sbiActiviteiten?.[0];
  const reason = signal?.heeftNieuweGegevens?.aanleiding;
  const startDay = toDay(signal?.heeftNieuweGegevens?.startdatum) ?? toDay(profile.materieleRegistratie?.datumAanvang);
  const nonMailing = profile.indNonMailing === "Ja" || signal?.heeftBetrekkingOp.nonMailing === true;
  const trade = profile.handelsnamen?.find((h) => h.naam !== profile.naam)?.naam;
  return {
    identity: { sourceId: profile.kvkNummer, name: clean(profile.naam) ?? profile.kvkNummer, registrationNumber: profile.kvkNummer },
    registration: {
      registrationDay: startDay,
      status: profile.materieleRegistratie?.datumEinde ? "Ended" : "Active",
      legalForm: profile._embedded?.eigenaar?.uitgebreideRechtsvorm ?? profile._embedded?.eigenaar?.rechtsvorm,
      legalFormCode: profile._embedded?.eigenaar?.rechtsvorm,
    },
    classification: {
      industryCode: main?.sbiCode,
      industryDescription: main?.sbiOmschrijving,
      codeSystem: main ? "SBI (NACE-based)" : undefined,
      naceCode: main?.sbiCode && /^\d{4}/.test(main.sbiCode) ? `${main.sbiCode.slice(0, 2)}.${main.sbiCode.slice(2, 4)}` : undefined,
      businessActivity: trade ? `Trade name: ${trade}` : undefined,
    },
    contact: {},
    address: {
      business:
        addr && !shielded
          ? { street: [addr.straatnaam, addr.huisnummer ? `${addr.huisnummer}${addr.huisletter ?? ""}` : undefined].filter(Boolean).join(" ") || undefined, postalCode: clean(addr.postcode), city: titleCase(clean(addr.plaats)), country: clean(addr.land) }
          : undefined,
    },
    marketingProtected: nonMailing,
    marketingRestrictionReason: nonMailing ? "KVK non-mailing indicator (indNonMailing)" : undefined,
    eventType: !reason || reason.code === "NW" ? "NEW_ENTITY" : `KVK_${reason.code}`,
    source: { publishedAt: signal ? new Date(signal.registratieTijdstip) : undefined, raw: { profile, signalReason: reason } },
  };
}

async function newRegistrationsFromSignals(list: SignalInfo[], subId: string, ctx: FetchContext) {
  const out: NormalizedCompany[] = [];
  for (const s of list.filter((x) => x.signaalType === "SignaalNieuweInschrijving")) {
    if (out.length >= ctx.limit) break;
    const detail = await get<SignalDetail>(`/v1/abonnementen/${subId}/signalen/${s.id}`, ctx.signal);
    const profile = await get<KvkBasisprofiel>(`/v1/basisprofielen/${s.kvknummer}`, ctx.signal);
    if (profile) out.push(normalizeKvk(profile, detail?.signaal));
  }
  return out;
}

export function createKvkProvider(): CompanyRegistryProvider {
  return {
    id: "kvk",
    countryCode: "NL",
    name: "KVK Mutatieservice + Basisprofiel",
    sourceName: "Kamer van Koophandel (KVK)",
    sourceType: "OFFICIAL_REGISTRY",
    freshness: "NEAR_REAL_TIME",
    isDemo: false,
    accessType: "API_KEY",
    registrationDateType: "KVK start date of the new registration (startdatum)",
    homepage: "https://www.kvk.nl",
    docsUrl: "https://developers.kvk.nl/documentation/mutatieservice-api",
    description: "Official Dutch Business Register change signals (paid KVK API subscription).",
    limitations: "Signals and Basisprofiel contain no email or phone. Companies with KVK's non-mailing indicator are restricted.",
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
    requiredEnv: ["NL_KVK_API_KEY"],
    isConfigured: () => !!KEY() && !(process.env.NODE_ENV === "production" && isTestEnv()),
    recommendedSyncMinutes: 60,
    feedIntervalSeconds: Number(process.env.NL_FEED_POLL_SECONDS || 60),

    async getRegistrations(from: Day, to: Day, ctx: FetchContext) {
      const subId = await subscriptionId(ctx.signal);
      const companies: NormalizedCompany[] = [];
      const vanaf = new Date(`${from}T00:00:00Z`);
      vanaf.setUTCDate(vanaf.getUTCDate() - 1); // include signals published around local midnight
      const tot = new Date(`${to}T00:00:00Z`);
      tot.setUTCDate(tot.getUTCDate() + 2);
      let total: number | undefined;
      for (let pagina = 1; pagina <= 200 && companies.length < ctx.limit; pagina++) {
        const page = await get<{ signalen?: SignalInfo[]; totaalPaginas?: number; totaal?: number }>(`/v1/abonnementen/${subId}?vanaf=${encodeURIComponent(vanaf.toISOString())}&tot=${encodeURIComponent(tot.toISOString())}&pagina=${pagina}&aantal=500`, ctx.signal);
        total = page?.totaal ?? total;
        const found = await newRegistrationsFromSignals(page?.signalen ?? [], subId, ctx);
        companies.push(...found.filter((c) => c.registration.registrationDay && c.registration.registrationDay >= from && c.registration.registrationDay <= to));
        if (!page?.totaalPaginas || pagina >= page.totaalPaginas) break;
      }
      return { companies, total, complete: true };
    },

    async pollChanges(cursor, ctx): Promise<ChangeBatch> {
      const subId = await subscriptionId(ctx.signal);
      if (!cursor) return { newCompanies: [], changedIds: [], removedIds: [], cursor: new Date(Date.now() - 20 * 60_000).toISOString(), publishedAts: [], more: false };
      const page = await get<{ signalen?: SignalInfo[]; totaalPaginas?: number }>(`/v1/abonnementen/${subId}?vanaf=${encodeURIComponent(cursor)}&pagina=1&aantal=500`, ctx.signal);
      const signals = (page?.signalen ?? []).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const newCompanies = await newRegistrationsFromSignals(signals, subId, ctx);
      const last = signals[signals.length - 1]?.timestamp;
      return {
        newCompanies,
        changedIds: signals.filter((s) => s.signaalType !== "SignaalNieuweInschrijving").map((s) => s.kvknummer),
        removedIds: [],
        cursor: last ?? cursor,
        publishedAts: newCompanies.map((c) => c.source.publishedAt).filter((d): d is Date => !!d),
        more: (page?.totaalPaginas ?? 1) > 1,
      };
    },

    async getCompany(kvk, ctx) {
      const profile = await get<KvkBasisprofiel>(`/v1/basisprofielen/${encodeURIComponent(kvk)}`, ctx?.signal);
      return profile ? normalizeKvk(profile) : null;
    },

    async checkStatus(): Promise<ProviderStatus> {
      if (!KEY()) return { state: "CREDENTIALS_REQUIRED", message: "Set NL_KVK_API_KEY (KVK API subscription).", checkedAt: new Date() };
      try {
        await subscriptionId();
        return { state: "CONNECTED", message: isTestEnv() ? "KVK TEST environment — fictional data" : undefined, checkedAt: new Date() };
      } catch (e) {
        const status = (e as { status?: number }).status;
        return { state: status === 401 || status === 403 ? "CREDENTIALS_REQUIRED" : "UNAVAILABLE", message: e instanceof Error ? e.message : String(e), checkedAt: new Date() };
      }
    },
  };
}

/** Local day of a KVK timestamp (for logs/tests). */
export const amsterdamDay = (iso: string) => todayIn("Europe/Amsterdam", new Date(iso));
