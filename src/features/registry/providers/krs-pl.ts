import "server-only";
import { addDays, eachDay, isDay, todayIn, type Day } from "@/lib/dates/country-time";
import { createHttpClient, mapLimit, ProviderHttpError } from "../http";
import { clean, cleanEmail, cleanWebsite, titleCase } from "../normalize-helpers";
import type { CompanyRegistryProvider, FetchContext, NormalizedCompany, ProviderStatus } from "../types";

/**
 * POLAND — National Court Register (KRS), official open API of the Ministry of Justice.
 * Docs: https://prs.ms.gov.pl/krs/openApi (no key).
 *
 *  - GET /api/krs/Biuletyn/{YYYY-MM-DD} → KRS numbers with any entry on that day (published
 *    the same day; verified 26 Oct 2026, 21:10 Warsaw time).
 *  - GET /api/krs/OdpisAktualny/{krs}?rejestr=P&format=json → current extract with
 *    `dataRejestracjiWKRS`, the official registration date.
 *
 * A company is imported only when its extract's registration date equals the bulletin day —
 * the date is never inferred. KRS numbers are assigned sequentially, so the day's new
 * registrations sit at the top of the bulletin; the scan walks down from the highest number and
 * stops after a run of extracts registered earlier. Business register (P) only — associations
 * (register S) return 404 for rejestr=P and are skipped. The public API masks board members'
 * names, so no people are stored. Email / website only when the company registered them.
 */
const BASE = (process.env.POLAND_KRS_API_URL || "https://api-krs.ms.gov.pl/api/krs").replace(/\/$/, "");
/** Consecutive older extracts after which the day's block of new numbers is considered passed. */
const STOP_AFTER_OLDER = Number(process.env.POLAND_KRS_STOP_AFTER || 40);
/**
 * Extracts are fetched in ordered parallel chunks: each answers in 3–8 s, so a sequential scan
 * of a ~350-entry day took 20+ minutes and never finished before the run was interrupted.
 * Request starts stay spaced by the client's minimum interval.
 */
const CONCURRENCY = Math.max(1, Number(process.env.POLAND_KRS_CONCURRENCY || 4));
const http = createHttpClient({ name: "KRS (Poland)", minIntervalMs: 250, timeoutMs: 30_000 });
/** Same queue and circuit as `http` (same name); the bulletin alone takes ~25 s to answer. */
const bulletinHttp = createHttpClient({ name: "KRS (Poland)", minIntervalMs: 250, timeoutMs: 120_000 });

type Person = { nazwisko?: { nazwiskoICzlon?: string }; imiona?: { imie?: string }; funkcjaWOrganie?: string };
type Pkd = { opis?: string; kodDzial?: string; kodKlasa?: string; kodPodklasa?: string };
type Subject = { formaPrawna?: string; nazwa?: string; identyfikatory?: { regon?: string; nip?: string } };
type Seat = {
  siedziba?: { wojewodztwo?: string; powiat?: string; gmina?: string; miejscowosc?: string };
  adres?: { ulica?: string; nrDomu?: string; nrLokalu?: string; miejscowosc?: string; kodPocztowy?: string; poczta?: string; kraj?: string };
  adresPocztyElektronicznej?: string;
  adresStronyInternetowej?: string;
};
export type KrsExtract = {
  odpis: {
    naglowekA: { rejestr?: string; numerKRS: string; dataRejestracjiWKRS?: string; dataOstatniegoWpisu?: string };
    dane: {
      dzial1: {
        danePodmiotu?: Subject;
        siedzibaIAdres?: Seat;
        /** Branches of foreign companies use these instead (verified on real extracts, Oct 2026). */
        danePodmiotuZagranicznego?: Subject;
        siedzibaIAdresPodmiotuZagranicznego?: Seat;
      };
      dzial2?: { reprezentacja?: { nazwaOrganu?: string; sklad?: Person[] } };
      dzial3?: { przedmiotDzialalnosci?: { przedmiotPrzewazajacejDzialalnosci?: Pkd[] } };
    };
  };
};

/** "23.10.2026" → "2026-10-23" (the registry's own calendar day). */
export function krsDay(v: string | undefined): Day | undefined {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v?.trim() ?? "");
  const day = m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
  return day && isDay(day) ? day : undefined;
}

/** KRS publishes text in capitals: "SPÓŁKA Z OGRANICZONĄ…" → "Spółka z ograniczoną…". */
const sentence = (v: string | undefined) => (v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : undefined);

export const padKrs = (n: string | number) => String(n).replace(/\D/g, "").padStart(10, "0");

/** Null when the extract has no recognisable company name (never guessed). */
export function normalizeKrsExtract(x: KrsExtract): NormalizedCompany | null {
  const a = x.odpis?.naglowekA;
  const d1 = x.odpis?.dane?.dzial1;
  if (!a?.numerKRS || !d1) return null;
  const foreign = !d1.danePodmiotu && !!d1.danePodmiotuZagranicznego;
  const subject = d1.danePodmiotu ?? d1.danePodmiotuZagranicznego;
  const place = d1.siedzibaIAdres ?? d1.siedzibaIAdresPodmiotuZagranicznego;
  const name = clean(subject?.nazwa);
  if (!name) return null;
  const addr = place?.adres;
  const seat = place?.siedziba;
  const pkd = x.odpis.dane.dzial3?.przedmiotDzialalnosci?.przedmiotPrzewazajacejDzialalnosci?.[0];
  const pkdCode = pkd?.kodDzial ? [pkd.kodDzial, pkd.kodKlasa, pkd.kodPodklasa].filter(Boolean).join(".") : undefined;
  const krs = padKrs(a.numerKRS);
  const street = [clean(addr?.ulica), [clean(addr?.nrDomu), clean(addr?.nrLokalu)].filter(Boolean).join("/")].filter(Boolean).join(" ");
  return {
    identity: { sourceId: krs, name, registrationNumber: krs },
    registration: { registrationDay: krsDay(a.dataRejestracjiWKRS), legalForm: sentence(clean(subject?.formaPrawna)), status: "Active" },
    classification: {
      industryCode: pkdCode,
      industryDescription: sentence(clean(pkd?.opis)),
      codeSystem: pkdCode ? "PKD 2025" : undefined,
      naceCode: pkd?.kodDzial && pkd.kodKlasa ? `${pkd.kodDzial}.${pkd.kodKlasa}` : undefined,
    },
    contact: { email: cleanEmail(place?.adresPocztyElektronicznej), website: cleanWebsite(place?.adresStronyInternetowej) },
    address: {
      business: {
        street: street || undefined,
        postalCode: clean(addr?.kodPocztowy),
        city: titleCase(clean(addr?.miejscowosc ?? seat?.miejscowosc)),
        region: titleCase(clean(seat?.wojewodztwo)),
        country: "Poland",
      },
    },
    // A branch of a foreign company is registered, but it is not a new legal entity.
    eventType: foreign ? "BRANCH" : "NEW_ENTITY",
    source: { url: `${BASE}/OdpisAktualny/${krs}?rejestr=P&format=json`, raw: { naglowekA: a, regon: subject?.identyfikatory?.regon, nip: subject?.identyfikatory?.nip } },
  };
}

/**
 * The client's timeout also covers reading the body, which it does not retry — and KRS often
 * stalls mid-body (seen as "The operation was aborted due to timeout" failing whole runs).
 */
async function retryingTimeouts<T>(load: () => Promise<T>, tries = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await load();
    } catch (e) {
      if (attempt >= tries || !(e instanceof Error && e.name === "TimeoutError")) throw e;
    }
  }
}

async function bulletin(day: Day, signal?: AbortSignal): Promise<string[]> {
  const list = await retryingTimeouts(() => bulletinHttp.json<unknown>(`${BASE}/Biuletyn/${day}`, { signal }));
  if (!Array.isArray(list)) throw new ProviderHttpError("KRS bulletin: unexpected response shape");
  return [...new Set(list.map((v) => padKrs(String(v))))].sort().reverse();
}

async function extract(krs: string, signal?: AbortSignal): Promise<KrsExtract | null> {
  return retryingTimeouts(() => extractOnce(krs, signal));
}

async function extractOnce(krs: string, signal?: AbortSignal): Promise<KrsExtract | null> {
  const res = await http.request(`${BASE}/OdpisAktualny/${krs}?rejestr=P&format=json`, { signal });
  if (res.status === 404 || res.status === 204) {
    await res.body?.cancel().catch(() => undefined);
    return null; // not in the business register (e.g. an association)
  }
  if (!res.ok) throw new ProviderHttpError(`KRS extract ${krs} responded ${res.status}`, res.status);
  return (await res.json()) as KrsExtract;
}

/** New registrations of one bulletin day (registration date verified per extract). */
export async function scanKrsDay(day: Day, ctx: FetchContext, get = extract, list = bulletin) {
  const numbers = await list(day, ctx.signal);
  const companies: NormalizedCompany[] = [];
  let older = 0;
  let checked = 0;
  let failed = 0;
  scan: for (let i = 0; i < numbers.length; i += CONCURRENCY) {
    const chunk = numbers.slice(i, i + CONCURRENCY);
    // KRS refuses connections under load now and then; a few unreadable extracts are skipped
    // (the run is marked incomplete and the next sync re-reads the day), a broken source fails.
    const extracts = await mapLimit(chunk, CONCURRENCY, (krs) =>
      get(krs, ctx.signal).catch((e) => {
        if (++failed > Math.max(10, numbers.length * 0.05)) throw e;
        ctx.log?.(`${day}: extract ${krs} could not be read (${e instanceof Error ? e.message : String(e)}) — skipped`);
        return null;
      }),
    );
    for (const [j, x] of extracts.entries()) {
      if (companies.length >= ctx.limit) break scan;
      checked++;
      if (!x) continue;
      const reg = krsDay(x.odpis?.naglowekA?.dataRejestracjiWKRS);
      if (reg === day) {
        const c = normalizeKrsExtract(x);
        if (c) companies.push(c);
        else ctx.log?.(`${day}: extract ${chunk[j]} has an unrecognised structure — skipped`);
        older = 0;
      } else if (reg && reg < day) {
        if (++older >= STOP_AFTER_OLDER) break scan;
      }
    }
    ctx.log?.(`${day}: checked ${checked}/${numbers.length} bulletin entries, ${companies.length} new`);
  }
  return { companies, checked, failed, listed: numbers.length };
}

export function createKrsPlProvider(): CompanyRegistryProvider {
  return {
    id: "krs-pl",
    countryCode: "PL",
    name: "KRS — National Court Register open API",
    sourceName: "Krajowy Rejestr Sądowy (KRS)",
    sourceType: "OFFICIAL_REGISTRY",
    freshness: "DAILY",
    isDemo: false,
    accessType: "OPEN",
    registrationDateType: "Date of entry in the KRS (dataRejestracjiWKRS)",
    homepage: "https://ekrs.ms.gov.pl",
    docsUrl: "https://prs.ms.gov.pl/krs/openApi",
    description: "Official Polish court register. The daily bulletin is published the same day; each new company is confirmed from its official extract. No API key.",
    limitations: "Business register (KRS P) only — associations and sole traders (CEIDG) are not included. Board members' names are masked by the public API. Email / website only when the company registered them.",
    capabilities: {
      supportsDailyRegistrations: true,
      supportsRealTimeSearch: false,
      supportsDailyUpdates: true,
      supportsRegistrationDate: true,
      supportsLookup: true,
      supportsEmail: true,
      supportsPhone: false,
      supportsMobile: false,
      supportsWebsite: true,
      supportsAddress: true,
      supportsIndustry: true,
      supportsDirectors: false,
      supportsRoles: false,
      supportsSourceUrl: true,
    },
    requiredEnv: [],
    isConfigured: () => true,
    recommendedSyncMinutes: 3 * 60,

    async getRegistrations(from: Day, to: Day, ctx: FetchContext) {
      if (!isDay(from) || !isDay(to)) throw new Error("Invalid date");
      const companies: NormalizedCompany[] = [];
      let complete = true;
      for (const day of eachDay(from, to)) {
        const left = ctx.limit - companies.length;
        if (left <= 0) {
          complete = false;
          break;
        }
        const r = await scanKrsDay(day, { ...ctx, limit: left });
        companies.push(...r.companies);
        if (r.failed) complete = false;
        ctx.log?.(`${day}: ${r.companies.length} new registrations (${r.checked} of ${r.listed} bulletin entries checked)`);
      }
      return { companies, complete };
    },

    async getCompany(num) {
      if (!/^\d{1,10}$/.test(num.trim())) return null;
      const x = await extract(padKrs(num));
      return x ? normalizeKrsExtract(x) : null;
    },

    async getLatestPublication() {
      // The bulletin for today exists once the registry has published entries for it.
      const today = todayIn("Europe/Warsaw");
      for (const day of [today, addDays(today, -1)]) {
        const list = await bulletin(day).catch(() => []);
        if (list.length) return new Date(`${day}T12:00:00Z`);
      }
      return null;
    },

    async checkStatus(): Promise<ProviderStatus> {
      try {
        const yesterday = addDays(todayIn("Europe/Warsaw"), -1);
        await bulletin(yesterday);
        return { state: "CONNECTED", checkedAt: new Date() };
      } catch (e) {
        return { state: "UNAVAILABLE", message: e instanceof Error ? e.message : String(e), checkedAt: new Date() };
      }
    },
  };
}
