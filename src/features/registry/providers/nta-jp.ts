import "server-only";
import { XMLParser } from "fast-xml-parser";
import { isDay, type Day } from "@/lib/dates/country-time";
import { createHttpClient } from "../http";
import { clean } from "../normalize-helpers";
import type { CompanyRegistryProvider, FetchContext, NormalizedCompany, ProviderStatus } from "../types";

/**
 * JAPAN — National Tax Agency, Corporate Number Publication Site Web-API (v4).
 * Spec: https://www.houjin-bangou.nta.go.jp/webapi/ — requires a free application ID
 * (JAPAN_HOUJIN_APP_ID), issued after registration with the NTA.
 *
 * Uses the period endpoint (/4/diff, XML Unicode, type=12) and keeps records with process "01"
 * (new designation). The date is the corporate number designation date (法人番号指定年月日):
 * official, but it records the number's designation after commercial registration — it is labelled
 * as such and never presented as the registration date itself. The adapter is written against
 * the published specification; it has NOT been run against the live API (no application ID yet).
 */
const BASE = (process.env.JAPAN_HOUJIN_API_URL || "https://api.houjin-bangou.nta.go.jp/4").replace(/\/$/, "");
const appId = () => process.env.JAPAN_HOUJIN_APP_ID?.trim() || "";
const http = createHttpClient({ name: "NTA Corporate Number Web-API", minIntervalMs: 1000, timeoutMs: 60_000 });
const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, processEntities: true, parseTagValue: false, trimValues: true });

/** Kinds that are companies (株式会社, 有限会社, 合名, 合資, 合同, other registered corporations, foreign companies). */
const KINDS: Record<string, string> = {
  "301": "Kabushiki kaisha (stock company)",
  "302": "Yugen kaisha (limited company)",
  "303": "Gomei kaisha (general partnership company)",
  "304": "Goshi kaisha (limited partnership company)",
  "305": "Godo kaisha (limited liability company)",
  "399": "Other registered corporation",
  "401": "Foreign company",
};

export type NtaCorporation = Record<string, string | undefined>;

export function normalizeNtaRecord(r: NtaCorporation): NormalizedCompany | null {
  const num = clean(r.corporateNumber);
  const name = clean(r.enName) ?? clean(r.name);
  const day = clean(r.assignmentDate);
  if (!num || !name || !day || !isDay(day) || r.process !== "01" || !KINDS[r.kind ?? ""]) return null;
  return {
    identity: { sourceId: num, name, registrationNumber: num },
    registration: { registrationDay: day, legalForm: KINDS[r.kind!], status: "Active" },
    classification: {},
    contact: {},
    address: { business: { street: clean(r.streetNumber), city: clean(r.cityName), region: clean(r.prefectureName), postalCode: clean(r.postCode), country: "Japan" } },
    eventType: r.kind === "401" ? "BRANCH" : "NEW_ENTITY",
    source: { url: "https://www.houjin-bangou.nta.go.jp/", raw: r },
  };
}

export function parseNtaXml(xml: string): { corporations: NtaCorporation[]; divideNumber: number; divideSize: number } {
  const doc = parser.parse(xml) as { corporations?: { corporation?: NtaCorporation | NtaCorporation[]; divideNumber?: string; divideSize?: string } };
  const root = doc.corporations ?? {};
  const list = root.corporation ? (Array.isArray(root.corporation) ? root.corporation : [root.corporation]) : [];
  return { corporations: list, divideNumber: Number(root.divideNumber ?? 1), divideSize: Number(root.divideSize ?? 1) };
}

export function createNtaJpProvider(): CompanyRegistryProvider {
  return {
    id: "nta-jp",
    countryCode: "JP",
    name: "NTA Corporate Number Publication Site — Web-API",
    sourceName: "National Tax Agency (Corporate Number Publication Site)",
    sourceType: "OFFICIAL_REGISTRY",
    freshness: "DAILY",
    isDemo: false,
    accessType: "API_KEY",
    registrationDateType: "Corporate number designation date (法人番号指定年月日) — follows commercial registration; not the registration date itself",
    homepage: "https://www.houjin-bangou.nta.go.jp",
    docsUrl: "https://www.houjin-bangou.nta.go.jp/webapi/",
    description: "Official register of Japanese corporate numbers. Free application ID required.",
    limitations: "Needs JAPAN_HOUJIN_APP_ID. Not yet run against the live API. The date is the corporate-number designation date. No industry, email, phone or website fields.",
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
    requiredEnv: ["JAPAN_HOUJIN_APP_ID"],
    isConfigured: () => appId().length > 0,
    recommendedSyncMinutes: 12 * 60,
    // Publishes with a lag: re-read the last 5 days so late filings are not missed.
    lookbackDays: 5,

    async getRegistrations(from: Day, to: Day, ctx: FetchContext) {
      if (!isDay(from) || !isDay(to)) throw new Error("Invalid date");
      if (!appId()) throw new Error("JAPAN_HOUJIN_APP_ID is not set");
      const companies: NormalizedCompany[] = [];
      let divide = 1;
      for (;;) {
        const res = await http.request(`${BASE}/diff?id=${encodeURIComponent(appId())}&from=${from}&to=${to}&type=12&divide=${divide}`, { signal: ctx.signal, headers: { Accept: "application/xml" } });
        if (!res.ok) throw new Error(`NTA Web-API responded ${res.status}`);
        const page = parseNtaXml(await res.text());
        for (const r of page.corporations) {
          const c = normalizeNtaRecord(r);
          if (c) companies.push(c);
        }
        ctx.log?.(`Page ${divide}/${page.divideSize}: ${companies.length} new corporations`);
        if (divide >= page.divideSize || companies.length >= ctx.limit) break;
        divide++;
      }
      return { companies: companies.slice(0, ctx.limit), total: companies.length, complete: companies.length <= ctx.limit };
    },

    async checkStatus(): Promise<ProviderStatus> {
      if (!appId()) return { state: "CREDENTIALS_REQUIRED", message: "Set JAPAN_HOUJIN_APP_ID", checkedAt: new Date() };
      try {
        const res = await http.request(`${BASE}/num?id=${encodeURIComponent(appId())}&number=7000012050002&type=12`, { headers: { Accept: "application/xml" } });
        await res.body?.cancel().catch(() => undefined);
        return res.ok ? { state: "CONNECTED", checkedAt: new Date() } : { state: "UNAVAILABLE", message: `NTA Web-API responded ${res.status}`, checkedAt: new Date() };
      } catch (e) {
        return { state: "UNAVAILABLE", message: e instanceof Error ? e.message : String(e), checkedAt: new Date() };
      }
    },
  };
}
