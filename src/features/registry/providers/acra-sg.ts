import "server-only";
import { isDay, type Day } from "@/lib/dates/country-time";
import { createHttpClient } from "../http";
import { bodyStream, cachedRows, csvObjects, lines } from "../bulk-file";
import { NO_CAPABILITIES, type CompanyRegistryProvider, type NormalizedCompany } from "../types";

const http = createHttpClient({ name: "ACRA data.gov.sg", minIntervalMs: 2200, timeoutMs: 120_000 });
const metadataUrl = "https://api-production.data.gov.sg/v2/public/api/collections/2/metadata";
const api = "https://api-open.data.gov.sg/v1/public/api/datasets";
const headers = () => process.env.SINGAPORE_DATA_GOV_API_KEY ? { "x-api-key": process.env.SINGAPORE_DATA_GOV_API_KEY } : undefined;
type Metadata = { code: number; data: { collectionMetadata: { childDatasets: string[]; lastUpdatedAt: string } } };
async function metadata(signal?: AbortSignal) {
  const m = await http.json<Metadata>(metadataUrl, { signal, headers: headers() });
  const c = m.data?.collectionMetadata;
  if (m.code !== 0 || !c?.childDatasets?.length || !Number.isFinite(Date.parse(c.lastUpdatedAt))) throw new Error("ACRA collection metadata is invalid");
  if (!c.childDatasets.every((id) => /^d_[a-f0-9]{32}$/.test(id))) throw new Error("Invalid ACRA dataset identifier");
  return c;
}
const value = (v?: string) => v && !/^(na|n\/a|nil|-)$/i.test(v.trim()) ? v.trim() : undefined;
export function normalizeAcraRecord(r: Record<string, string>, publishedAt?: Date): NormalizedCompany | null {
  const uen = value(r.uen)?.toUpperCase();
  const name = value(r.entity_name);
  const day = r.registration_incorporation_date?.slice(0, 10);
  if (!uen || !/^[A-Z0-9]{9,10}$/.test(uen) || !name || !day || !isDay(day)) return null;
  return {
    identity: { sourceId: uen, registrationNumber: uen, name },
    registration: { registrationDay: day, incorporationDay: day, status: value(r.entity_status_description), legalForm: value(r.company_type_description) ?? value(r.entity_type_description) },
    classification: { industryCode: value(r.primary_ssic_code), industryDescription: value(r.primary_ssic_description), businessActivity: value(r.primary_user_described_activity) ?? value(r.primary_ssic_description), codeSystem: "SSIC" },
    contact: {},
    // Public registry addresses can be residences. Do not import without business-premises evidence.
    address: {},
    source: { url: "https://data.gov.sg/collections/2/view", updatedAt: publishedAt, publishedAt },
  };
}

export function createAcraSgProvider(): CompanyRegistryProvider {
  return {
    id: "acra-sg", countryCode: "SG", name: "ACRA — monthly open data", sourceName: "Accounting and Corporate Regulatory Authority (ACRA)", sourceType: "OFFICIAL_OPEN_DATA", freshness: "PERIODIC", isDemo: false,
    accessType: "OPEN", homepage: "https://www.acra.gov.sg", docsUrl: "https://data.gov.sg/collections/2/view",
    description: "Monthly ACRA snapshots polled daily; registration dates remain the dates published by ACRA.",
    limitations: "Monthly publication, not daily discovery. No email, telephone, website or named officers. Addresses withheld because business premises cannot be distinguished from residences. SSIC availability depends on the dataset edition.",
    registrationDateType: "ACRA registration/incorporation date",
    capabilities: { ...NO_CAPABILITIES, supportsDailyRegistrations: true, supportsRegistrationDate: true, supportsIndustry: true, supportsSourceUrl: true },
    requiredEnv: [], isConfigured: () => true, recommendedSyncMinutes: 1440, lookbackDays: 90, recommendedBatchLimit: 100_000,
    async getRegistrations(from: Day, to: Day, ctx) {
      if (!isDay(from) || !isDay(to) || from > to) throw new Error("Invalid ACRA date window");
      const meta = await metadata(ctx.signal);
      const publishedAt = new Date(meta.lastUpdatedAt);
      const companies = new Map<string, NormalizedCompany>();
      for (const id of meta.childDatasets) {
        // The publication timestamp keys the local cache. The file helper also honours ETag.
        let poll = await http.json<{ code: number; data?: { url?: string } }>(`${api}/${id}/poll-download`, { signal: ctx.signal, headers: headers() });
        if (poll.code !== 0 || !poll.data?.url) {
          await http.json(`${api}/${id}/initiate-download`, { signal: ctx.signal, headers: headers() });
          for (let attempt = 0; attempt < 5 && !poll.data?.url; attempt++) {
            ctx.signal?.throwIfAborted();
            poll = await http.json(`${api}/${id}/poll-download`, { signal: ctx.signal, headers: headers() });
          }
          if (poll.code !== 0 || !poll.data?.url) throw new Error(`ACRA dataset ${id} download is preparing; retry the sync after preparation completes`);
        }
        const url = new URL(poll.data.url);
        if (url.protocol !== "https:" || !(/(^|\.)data\.gov\.sg$/.test(url.hostname) || /(^|\.)amazonaws\.com$/.test(url.hostname))) throw new Error("Unexpected ACRA download host");
        const { rows } = await cachedRows<NormalizedCompany>(`acra:${id}:${meta.lastUpdatedAt}`, { http, url: url.href, since: from, signal: ctx.signal,
          async parse(res, since) {
            const out: NormalizedCompany[] = [];
            for await (const row of csvObjects(lines(bodyStream(res)), ",")) {
              const c = normalizeAcraRecord(row, publishedAt);
              if (c && c.registration.registrationDay! >= since) out.push(c);
            }
            return out;
          },
        });
        for (const c of rows) if (c.registration.registrationDay! <= to) companies.set(c.identity.sourceId, c);
        ctx.log?.(`ACRA: ${id} checked (${companies.size} in window)`);
      }
      const all = [...companies.values()].sort((a, b) => a.identity.sourceId.localeCompare(b.identity.sourceId));
      return { companies: all.slice(0, ctx.limit), total: all.length, complete: all.length <= ctx.limit };
    },
    async getLatestPublication() { return new Date((await metadata()).lastUpdatedAt); },
    async checkStatus() {
      try { await metadata(); return { state: "CONNECTED", checkedAt: new Date() }; }
      catch (err) { return { state: "UNAVAILABLE", message: err instanceof Error ? err.message : String(err), checkedAt: new Date() }; }
    },
  };
}
