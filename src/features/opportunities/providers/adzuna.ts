import "server-only";
import { createHttpClient } from "@/features/registry/http";
import { cleanUrl, parseSourceDate, truncate } from "../normalize";
import type { FetchContext, FetchResult, NormalizedOpportunity, OpportunityProvider } from "./types";

/**
 * Adzuna job search API — a THIRD-PARTY AGGREGATOR. Records are never labelled as
 * employer posts: the original employer posting is not established and the link is
 * Adzuna's redirect. Useful only to spot hiring activity where no official national
 * source is integrated (UK, Germany).
 *   GET https://api.adzuna.com/v1/api/jobs/{country}/search/{page}?app_id&app_key&max_days_old&sort_by=date
 * Terms: default limits 25/min, 250/day; commercial use beyond the trial requires an
 * agreement with Adzuna, and displayed ads need "Jobs by Adzuna" attribution — so this
 * provider stays disabled until the owner explicitly enables it.
 * Built from documentation; not exercised with real credentials during build.
 */
const http = createHttpClient({ name: "Adzuna API", minIntervalMs: 2_600, timeoutMs: 30_000 });
const COUNTRIES: Record<string, string> = { GB: "gb", DE: "de", FR: "fr" };

type AdzunaJob = {
  id: string;
  title?: string;
  description?: string;
  created?: string;
  redirect_url?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  category?: { label?: string; tag?: string };
  contract_type?: string;
  contract_time?: string;
};

function creds() {
  return { id: process.env.ADZUNA_APP_ID?.trim(), key: process.env.ADZUNA_APP_KEY?.trim() };
}

export const adzunaProvider: OpportunityProvider = {
  id: "adzuna",
  name: "Adzuna (aggregator)",
  publisher: "Adzuna Ltd",
  type: "HIRING",
  defaultSourceClass: "THIRD_PARTY_AGGREGATOR",
  perEmployer: false,
  coverage: [
    { code: "GB", level: "PARTIAL", note: "Aggregated ads; employer posting not established." },
    { code: "DE", level: "PARTIAL", note: "Aggregated ads; employer posting not established." },
    { code: "FR", level: "PARTIAL", note: "Aggregated ads; employer posting not established." },
  ],
  access: {
    type: "API_KEY",
    requiredEnv: ["ADZUNA_APP_ID", "ADZUNA_APP_KEY"],
    signupUrl: "https://developer.adzuna.com/",
    termsUrl: "https://developer.adzuna.com/docs/terms_of_service",
    termsNote: "Free key with low default limits (250 calls/day). Commercial use beyond the trial must be agreed with Adzuna; displayed ads require “Jobs by Adzuna” attribution.",
  },
  docsUrl: "https://developer.adzuna.com/docs/search",
  homepage: "https://www.adzuna.com",
  description: "Aggregated job ads for the UK, Germany and France with company display name, category and Adzuna redirect link.",
  limitations: "Aggregator: no employer identity, no closing status, link is an Adzuna redirect. Not available for Norway, Sweden, Denmark or Finland.",
  capabilities: { incremental: true, pagination: true, publishedAt: true, updatedAt: false, deadline: false, removalDetection: "NONE", activityCheck: false, employerIdentity: "NAME_ONLY", contacts: false, webhooks: false, directApplyLink: false },
  evidence: "DOCUMENTED_NOT_TESTED",
  freshnessNote: "Polled a few times a day within the daily call limit.",
  recommendedIntervalMinutes: 360,
  requiresAgreement: true,
  settingFields: [
    { key: "what", label: "Keywords", kind: "text", defaultValue: "developer", help: "Adzuna “what” query (required to keep within the daily call limit)." },
    { key: "countries", label: "Countries", kind: "list", defaultValue: "GB, DE, FR", help: "Subset of GB, DE, FR." },
    { key: "pagesPerCountry", label: "Pages per country per run", kind: "number", defaultValue: 2, help: "50 results per page; each page is one API call." },
  ],
  isConfigured: () => {
    const { id, key } = creds();
    const missing = [...(id ? [] : ["ADZUNA_APP_ID"]), ...(key ? [] : ["ADZUNA_APP_KEY"])];
    return { ok: missing.length === 0, missing, message: missing.length ? "Needs an Adzuna app id and key." : undefined };
  },
  async fetch(ctx: FetchContext): Promise<FetchResult> {
    const { id, key } = creds();
    if (!id || !key) throw new Error("Adzuna credentials are not set.");
    const countries = String(ctx.feed.settings.countries ?? "GB, DE, FR").split(/[,\s]+/).map((c) => c.toUpperCase()).filter((c) => COUNTRIES[c]);
    const pages = Math.min(Math.max(Number(ctx.feed.settings.pagesPerCountry ?? 2), 1), 5);
    const what = String(ctx.feed.settings.what ?? "developer");
    const maxDays = ctx.cursor ? Math.max(1, Math.ceil((Date.now() - new Date(ctx.cursor).getTime()) / 86_400_000)) : 3;
    const items: NormalizedOpportunity[] = [];
    for (const cc of countries) {
      for (let page = 1; page <= pages; page++) {
        const q = new URLSearchParams({ app_id: id, app_key: key, results_per_page: "50", max_days_old: String(Math.min(maxDays, 14)), sort_by: "date", what, "content-type": "application/json" });
        const data = await http.json<{ results?: AdzunaJob[] }>(`https://api.adzuna.com/v1/api/jobs/${COUNTRIES[cc]}/search/${page}?${q}`, { signal: ctx.signal });
        const batch = data.results ?? [];
        for (const j of batch) {
          items.push({
            externalId: String(j.id),
            type: "HIRING",
            title: j.title?.replace(/<[^>]+>/g, "") ?? "(untitled ad)",
            organization: { name: j.company?.display_name },
            countryCode: cc,
            location: j.location?.display_name,
            summary: truncate(j.description?.replace(/<[^>]+>/g, ""), 1000),
            sourceUrl: cleanUrl(j.redirect_url),
            thirdPartyUrl: cleanUrl(j.redirect_url),
            sourceClass: "THIRD_PARTY_AGGREGATOR",
            sourcePublisher: "Adzuna (aggregator) — Jobs by Adzuna",
            publishedAt: parseSourceDate(j.created),
            jobCategory: j.category?.label,
            employmentType: [j.contract_type, j.contract_time].filter(Boolean).join(", ") || undefined,
          });
        }
        if (batch.length < 50) break;
      }
    }
    return { items, complete: true, cursor: new Date().toISOString() };
  },
};
