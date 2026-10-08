import "server-only";
import { XMLParser } from "fast-xml-parser";
import { addDays, eachDay, toDay, type Day } from "@/lib/dates/country-time";
import { createHttpClient, ProviderHttpError } from "../http";
import { clean, cleanEmail, cleanPhone, cleanWebsite } from "../normalize-helpers";
import type { ChangeBatch, CompanyRegistryProvider, FetchContext, NormalizedCompany, ProviderStatus } from "../types";

/**
 * ESTONIA — e-Business Register (RIK) XML services (SOAP, X-Road producer namespace).
 * Docs: https://avaandmed.ariregister.rik.ee/en/open-data-api/introduction-api-services
 *   arireg.ettevotjaMuudatusedTasuline_v1 — changes for one date (kuupaev), 500 results/page (tulemuste_lk)
 *   arireg.detailandmed_v2                 — general data (yandmed=1) incl. sidevahendid (EMAIL/TEL/MOB/WWW)
 * Requires an agreement with RIK + username/password. Limits: 50 000 answers/day, 1 concurrent query.
 * Personnel data (iandmed) is NOT requested — not needed for sales research.
 *
 * First registrations are identified from the detail's first registration date
 * (esmaregistreerimise_kpv) rather than an unverified entry-type code.
 * Implemented from the published documentation; not yet authenticated against production.
 */
const BASE = (process.env.ESTONIA_RIK_API_URL || "https://ariregxmlv6.rik.ee/").replace(/\/?$/, "/");
const USER = () => process.env.ESTONIA_RIK_USERNAME || "";
const PASS = () => process.env.ESTONIA_RIK_PASSWORD || "";
const NS = "http://arireg.x-road.eu/producer/";
// One concurrent query (RIK limit) — the client serializes requests.
const http = createHttpClient({ name: "RIK e-Business Register", minIntervalMs: 300, timeoutMs: 30_000 });

/** Safe XML parsing: no DTD / entity expansion, no external resources. */
const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, processEntities: false, parseTagValue: false, trimValues: true });

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function envelope(operation: string, fields: Record<string, string | number>) {
  const body = Object.entries(fields)
    .map(([k, v]) => `<prod:${k}>${esc(String(v))}</prod:${k}>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:prod="${NS}"><soapenv:Header/><soapenv:Body><prod:${operation}><prod:keha><prod:ariregister_kasutajanimi>${esc(USER())}</prod:ariregister_kasutajanimi><prod:ariregister_parool>${esc(PASS())}</prod:ariregister_parool>${body}</prod:keha></prod:${operation}></soapenv:Body></soapenv:Envelope>`;
}

async function call(operation: string, fields: Record<string, string | number>, signal?: AbortSignal): Promise<unknown> {
  const res = await http.request(BASE, { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" }, body: envelope(operation, fields), signal });
  const text = await res.text();
  if (text.length > 20_000_000) throw new ProviderHttpError("RIK response too large");
  const doc = parser.parse(text) as Record<string, unknown>;
  const fault = findKey(doc, "Fault") as { faultstring?: string } | undefined;
  if (fault) {
    const msg = String(fault.faultstring ?? "SOAP fault");
    throw new ProviderHttpError(`RIK: ${msg}`, /parool|kasutaja|password|auth/i.test(msg) ? 401 : undefined);
  }
  if (!res.ok) throw new ProviderHttpError(`RIK responded ${res.status}`, res.status, true);
  return doc;
}

/** Depth-first search for the first value under `key` (namespace prefixes already removed). */
function findKey(node: unknown, key: string): unknown {
  if (!node || typeof node !== "object") return undefined;
  if (key in (node as Record<string, unknown>)) return (node as Record<string, unknown>)[key];
  for (const v of Object.values(node as Record<string, unknown>)) {
    const r = findKey(v, key);
    if (r !== undefined) return r;
  }
  return undefined;
}

/** All objects that contain `key` (e.g. every change item with ariregistri_kood). */
function collectObjectsWith(node: unknown, key: string, out: Record<string, unknown>[] = []) {
  if (Array.isArray(node)) node.forEach((n) => collectObjectsWith(n, key, out));
  else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (key in o && typeof o[key] !== "object") out.push(o);
    else Object.values(o).forEach((v) => collectObjectsWith(v, key, out));
  }
  return out;
}

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Map a detailandmed_v2 company node. Exported for tests (built from the documented element names). */
export function normalizeRikDetail(company: Record<string, unknown>): NormalizedCompany | null {
  const code = String(company.ariregistri_kood ?? "");
  if (!code) return null;
  const yld = (company.yldandmed ?? {}) as Record<string, unknown>;
  const contacts = collectObjectsWith(yld.sidevahendid ?? company.sidevahendid, "liik").map((s) => ({ liik: String(s.liik), sisu: String(s.sisu ?? "") }));
  const pick = (liik: string) => contacts.find((x) => x.liik === liik && x.sisu)?.sisu;
  const addr = collectObjectsWith(yld.aadressid ?? company.aadressid, "tanav_maja_korter")[0];
  const act = collectObjectsWith(yld.teatatud_tegevusalad ?? company.teatatud_tegevusalad, "emtak_kood")[0];
  const nace = act?.nace_kood ? String(act.nace_kood) : undefined;
  return {
    identity: { sourceId: code, name: clean(String(company.nimi ?? "")) ?? code, registrationNumber: code },
    registration: {
      registrationDay: toDay(String(yld.esmaregistreerimise_kpv ?? "")),
      status: clean(String(yld.staatus_tekstina ?? "")),
      legalForm: clean(String(yld.oiguslik_vorm_tekstina ?? "")),
      legalFormCode: clean(String(yld.oiguslik_vorm ?? "")),
    },
    classification: {
      industryCode: act?.emtak_kood ? String(act.emtak_kood) : undefined,
      industryDescription: act?.emtak_tekstina ? String(act.emtak_tekstina) : undefined,
      codeSystem: act ? "EMTAK (NACE-based)" : undefined,
      naceCode: nace && /^\d{4}/.test(nace.replace(".", "")) ? `${nace.replace(".", "").slice(0, 2)}.${nace.replace(".", "").slice(2, 4)}` : undefined,
    },
    contact: { email: cleanEmail(pick("EMAIL")), phone: cleanPhone(pick("TEL"), "EE"), mobile: cleanPhone(pick("MOB"), "EE"), website: cleanWebsite(pick("WWW")) },
    address: { business: addr ? { street: clean(String(addr.tanav_maja_korter ?? "")), postalCode: clean(String(addr.postiindeks ?? "")), city: clean(String(addr.ehak_nimetus ?? "")), country: "Estonia" } : undefined },
    source: { url: `https://ariregister.rik.ee/eng/company/${code}`, raw: company },
  };
}

async function detail(code: string, signal?: AbortSignal) {
  const doc = await call("detailandmed_v2", { ariregistri_kood: code, yandmed: 1, iandmed: 0, kandmed: 0, dandmed: 0, maarused: 0, keel: "eng" }, signal);
  const node = collectObjectsWith(doc, "ariregistri_kood").find((o) => o.nimi !== undefined || o.yldandmed !== undefined);
  return node ? normalizeRikDetail(node) : null;
}

async function changeCodes(day: Day, signal?: AbortSignal) {
  const codes = new Set<string>();
  for (let page = 1; page <= 200; page++) {
    const doc = await call("ettevotjaMuudatusedTasuline_v1", { kuupaev: day, tulemuste_lk: page }, signal);
    const items = collectObjectsWith(doc, "ariregistri_kood");
    for (const i of items) codes.add(String(i.ariregistri_kood));
    if (items.length < 500) break;
  }
  return [...codes];
}

export function createRikProvider(): CompanyRegistryProvider {
  return {
    id: "rik",
    countryCode: "EE",
    name: "RIK e-Business Register XML services",
    sourceName: "e-Business Register (RIK)",
    sourceType: "OFFICIAL_REGISTRY",
    freshness: "REAL_TIME",
    isDemo: false,
    accessType: "AGREEMENT",
    registrationDateType: "First registration date (esmaregistreerimise_kpv)",
    homepage: "https://ariregister.rik.ee",
    docsUrl: "https://avaandmed.ariregister.rik.ee/en/open-data-api/introduction-api-services",
    description: "Official Estonian business register XML services (agreement with RIK required; API-only use free within limits).",
    limitations: "Implemented from published documentation — not yet authenticated. Limits: 50 000 answers/day, 1 concurrent query.",
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
      supportsDirectors: false,
      supportsRoles: false,
      supportsSourceUrl: true,
    },
    requiredEnv: ["ESTONIA_RIK_USERNAME", "ESTONIA_RIK_PASSWORD"],
    isConfigured: () => !!USER() && !!PASS(),
    recommendedSyncMinutes: 60,
    feedIntervalSeconds: Number(process.env.ESTONIA_FEED_POLL_SECONDS || 300),

    async getRegistrations(from: Day, to: Day, ctx: FetchContext) {
      const companies: NormalizedCompany[] = [];
      for (const day of eachDay(from, to)) {
        for (const code of await changeCodes(day, ctx.signal)) {
          if (companies.length >= ctx.limit) break;
          const d = await detail(code, ctx.signal);
          if (d?.registration.registrationDay && d.registration.registrationDay >= from && d.registration.registrationDay <= to) companies.push(d);
        }
      }
      return { companies, complete: companies.length < ctx.limit };
    },

    async pollChanges(cursor, ctx): Promise<ChangeBatch> {
      // Cursor = the last fully processed change date (YYYY-MM-DD); today is re-checked until tomorrow.
      const today = new Date().toISOString().slice(0, 10);
      if (!cursor) return { newCompanies: [], changedIds: [], removedIds: [], cursor: addDays(today, -1), publishedAts: [], more: false };
      const day = cursor < today ? addDays(cursor, 1) : today;
      const codes = await changeCodes(day, ctx.signal);
      const newCompanies: NormalizedCompany[] = [];
      const changedIds: string[] = [];
      for (const code of codes.slice(0, ctx.limit)) {
        const d = await detail(code, ctx.signal);
        if (!d) continue;
        if (d.registration.registrationDay && d.registration.registrationDay >= addDays(day, -1)) newCompanies.push(d);
        else changedIds.push(code);
      }
      return { newCompanies, changedIds, removedIds: [], cursor: day < today ? day : addDays(today, -1), publishedAts: [], more: day < today };
    },

    async getCompany(code, ctx) {
      return detail(code, ctx?.signal);
    },

    async checkStatus(): Promise<ProviderStatus> {
      if (!USER() || !PASS()) return { state: "CREDENTIALS_REQUIRED", message: "Sign an agreement with RIK and set ESTONIA_RIK_USERNAME / ESTONIA_RIK_PASSWORD.", checkedAt: new Date() };
      try {
        await changeCodes(new Date().toISOString().slice(0, 10));
        return { state: "CONNECTED", checkedAt: new Date() };
      } catch (e) {
        const status = (e as { status?: number }).status;
        return { state: status === 401 ? "CREDENTIALS_REQUIRED" : "UNAVAILABLE", message: e instanceof Error ? e.message : String(e), checkedAt: new Date() };
      }
    },
  };
}

export const __test = { envelope, parser, collectObjectsWith, asArray };
