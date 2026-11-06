import "server-only";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { isDay } from "@/lib/dates/country-time";
import { NO_CAPABILITIES, type CompanyRegistryProvider, type NormalizedCompany } from "../types";

/** Internal interchange contract, NOT an asserted SSM API or export format. */
export const ssmExportSchema = z.object({
  sourceUrl: z.url().refine((v) => new URL(v).protocol === "https:"),
  publishedAt: z.iso.datetime({ offset: true }),
  records: z.array(z.object({
    registrationNumber: z.string().trim().regex(/^\d{12}$/),
    oldRegistrationNumber: z.string().trim().regex(/^\d{1,7}-?[A-Z]$/i).optional(),
    name: z.string().trim().min(1), registrationDay: z.string().refine(isDay),
    status: z.string().optional(), companyType: z.string().optional(), activity: z.string().optional(), industryCode: z.string().optional(),
    businessAddress: z.object({ street: z.string().trim().optional(), city: z.string().trim().optional(), region: z.string().trim().optional(), postalCode: z.string().trim().regex(/^\d{5}$/).optional(), confirmedNonResidential: z.literal(true) }).optional(),
  }).strict()),
}).strict();
export function normalizeSsmExport(input: unknown): NormalizedCompany[] {
  const data = ssmExportSchema.parse(input);
  return data.records.map((r) => ({
    identity: { sourceId: r.registrationNumber, registrationNumber: r.registrationNumber, name: r.name },
    registration: { registrationDay: r.registrationDay, incorporationDay: r.registrationDay, status: r.status, legalForm: r.companyType },
    classification: { industryCode: r.industryCode, codeSystem: r.industryCode ? "MSIC" : undefined, businessActivity: r.activity }, contact: {},
    address: r.businessAddress ? { business: { street: r.businessAddress.street, city: r.businessAddress.city, region: r.businessAddress.region, postalCode: r.businessAddress.postalCode, country: "Malaysia" } } : {},
    source: { url: data.sourceUrl, updatedAt: new Date(data.publishedAt), publishedAt: new Date(data.publishedAt), raw: { oldRegistrationNumber: r.oldRegistrationNumber } },
  }));
}
async function load() {
  if (process.env.MALAYSIA_SSM_EXPORT_AUTHORIZED !== "true" || !process.env.MALAYSIA_SSM_EXPORT_PATH) throw new Error("SSM licensed export not configured: set MALAYSIA_SSM_EXPORT_PATH and MALAYSIA_SSM_EXPORT_AUTHORIZED=true only after obtaining permitted data access");
  return ssmExportSchema.parse(JSON.parse(await readFile(process.env.MALAYSIA_SSM_EXPORT_PATH, "utf8")));
}
export function createSsmMyProvider(): CompanyRegistryProvider {
  return {
    id: "ssm-my", countryCode: "MY", name: "SSM — licensed export", sourceName: "Suruhanjaya Syarikat Malaysia (SSM)", sourceType: "OFFICIAL_REGISTRY", freshness: "UNKNOWN", isDemo: false, accessType: "AGREEMENT",
    homepage: "https://www.ssm.com.my", docsUrl: "https://www.ssm.com.my/Pages/Product/Corporate-and-Business-Information-Data-(CBID).aspx",
    description: "Daily ingestion of an authorized SSM export supplied by the operator. No public daily API is claimed.",
    limitations: "Requires licensed data, supplier delivery and conversion to the documented internal JSON contract. Publication cadence is supplier-dependent and unverified. No personal contacts or named owners imported. Both old and new IDs must be mapped by the supplier; only the 12-digit ID identifies companies.",
    registrationDateType: "SSM incorporation date", capabilities: { ...NO_CAPABILITIES, supportsDailyRegistrations: true, supportsRegistrationDate: true, supportsIndustry: true, supportsAddress: true, supportsSourceUrl: true },
    requiredEnv: ["MALAYSIA_SSM_EXPORT_PATH", "MALAYSIA_SSM_EXPORT_AUTHORIZED"],
    isConfigured: () => !!process.env.MALAYSIA_SSM_EXPORT_PATH && process.env.MALAYSIA_SSM_EXPORT_AUTHORIZED === "true", recommendedSyncMinutes: 1440, lookbackDays: 90, recommendedBatchLimit: 100_000,
    async getRegistrations(from, to, ctx) {
      if (!isDay(from) || !isDay(to) || from > to) throw new Error("Invalid SSM date window");
      const unique = new Map<string, NormalizedCompany>();
      for (const c of normalizeSsmExport(await load())) if (c.registration.registrationDay! >= from && c.registration.registrationDay! <= to) {
        const prior = unique.get(c.identity.sourceId);
        if (prior && JSON.stringify(prior) !== JSON.stringify(c)) throw new Error(`Conflicting SSM records for ${c.identity.sourceId}`);
        unique.set(c.identity.sourceId, c);
      }
      const companies = [...unique.values()];
      return { companies: companies.slice(0, ctx.limit), total: companies.length, complete: companies.length <= ctx.limit };
    },
    async getLatestPublication() { return new Date((await load()).publishedAt); },
    async checkStatus() {
      try { await load(); return { state: "CONNECTED", checkedAt: new Date() }; }
      catch (err) { return { state: this.isConfigured() ? "UNAVAILABLE" : "CREDENTIALS_REQUIRED", message: err instanceof Error ? err.message : String(err), checkedAt: new Date() }; }
    },
  };
}
