import "server-only";
import { createHttpClient, ProviderHttpError } from "@/features/registry/http";
import { OPPORTUNITY_COUNTRIES } from "@/config/opportunity-countries";
import { cleanUrl, normalizeRegNumber, parseDeadline, parseSourceDate, pickLang, truncate, uniq } from "../normalize";
import type { ActivityCheckResult, FetchContext, FetchResult, NormalizedContact, NormalizedOpportunity, OpportunityProvider } from "./types";

/**
 * EU — TED (Tenders Electronic Daily), Publications Office of the EU.
 *   POST https://api.ted.europa.eu/v3/notices/search   (anonymous search; no key needed)
 * Expert query over eForms fields; one publication day per query with PAGE_NUMBER pagination.
 * Covers notices above EU/EEA thresholds for EU members and Norway (EEA). The UK left
 * TED in 2021 (see Find a Tender). Notices published Monday–Friday.
 */
const URL_SEARCH = "https://api.ted.europa.eu/v3/notices/search";
const http = createHttpClient({ name: "TED Search API", minIntervalMs: 700, timeoutMs: 45_000 });
const DEFAULT_CPV = ["72000000", "48000000", "79340000", "79400000", "79600000", "79310000"];
const TED_COUNTRIES = ["NO", "SE", "DK", "FI", "DE", "FR"];
const FIELDS = [
  "publication-number",
  "notice-title",
  "buyer-name",
  "buyer-country",
  "organisation-identifier-buyer",
  "publication-date",
  "deadline-receipt-tender-date-lot",
  "classification-cpv",
  "notice-type",
  "form-type",
  "contract-nature",
  "buyer-email",
  "buyer-internet-address",
  "submission-url-lot",
  "document-url-lot",
  "description-lot",
  "place-of-performance-country-proc",
  "links",
];

type TedNotice = Record<string, unknown> & { "publication-number": string; links?: { html?: Record<string, string> } };

function list(settings: Record<string, unknown>, key: string, fallback: string[]) {
  const raw = settings[key];
  const v = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split(/[,\s]+/) : [];
  const out = v.map((s) => s.trim()).filter(Boolean);
  return out.length ? out : fallback;
}

const tedDay = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : []);

export function normalizeTedNotice(n: TedNotice): NormalizedOpportunity {
  const pub = n["publication-number"];
  const buyerIso3 = arr(n["buyer-country"])[0];
  const country = OPPORTUNITY_COUNTRIES.find((c) => c.iso3 === buyerIso3)?.code;
  const deadlines = arr(n["deadline-receipt-tender-date-lot"]).sort();
  const { deadline, deadlineText } = parseDeadline(deadlines[0]);
  const cpv = uniq(arr(n["classification-cpv"]));
  const contacts: NormalizedContact[] = [];
  for (const e of uniq(arr(n["buyer-email"]))) contacts.push({ kind: "ORGANIZATION_EMAIL", email: e });
  const website = cleanUrl(arr(n["buyer-internet-address"])[0]);
  if (website) contacts.push({ kind: "ORGANIZATION_WEBSITE", url: website });
  const submission = cleanUrl(arr(n["submission-url-lot"])[0]);
  if (submission) contacts.push({ kind: "SUBMISSION_LINK", url: submission });
  const html = n.links?.html ?? {};
  const formType = String(n["form-type"] ?? "");
  return {
    externalId: pub,
    type: "PROCUREMENT",
    title: (pickLang(n["notice-title"]) ?? pub).trim(),
    organization: { name: pickLang(n["buyer-name"]), registrationNumber: normalizeRegNumber(arr(n["organisation-identifier-buyer"])[0]), registrationCountry: country, website },
    countryCode: country,
    location: uniq(arr(n["place-of-performance-country-proc"])).join(", ") || undefined,
    summary: truncate(pickLang(n["description-lot"]), 4000),
    sourceUrl: html.ENG ?? `https://ted.europa.eu/en/notice/-/detail/${encodeURIComponent(pub)}`,
    applyUrl: submission ?? cleanUrl(arr(n["document-url-lot"])[0]),
    sourceClass: "OFFICIAL_PROCUREMENT_PORTAL",
    sourcePublisher: "TED — Publications Office of the EU",
    publishedAt: parseSourceDate(String(n["publication-date"] ?? "")),
    deadline,
    deadlineText,
    classification: { scheme: "CPV", codes: cpv },
    noticeKind: formType === "planning" ? "Prior information notice" : formType === "competition" ? "Contract notice (call for competition)" : formType || undefined,
    contacts,
  };
}

export const tedProvider: OpportunityProvider = {
  id: "ted",
  name: "TED — Tenders Electronic Daily",
  publisher: "Publications Office of the European Union",
  type: "PROCUREMENT",
  defaultSourceClass: "OFFICIAL_PROCUREMENT_PORTAL",
  perEmployer: false,
  coverage: TED_COUNTRIES.map((code) => ({ code, level: "PARTIAL" as const, note: "Notices above EU/EEA procurement thresholds only; below-threshold notices are published nationally." })),
  access: { type: "OPEN", requiredEnv: [], signupUrl: "https://developer.ted.europa.eu", termsUrl: "https://op.europa.eu/en/web/about-us/legal-notices/eu-law-and-publications-website", termsNote: "Anonymous search access; TED data is reusable under the EU Publications Office reuse policy." },
  docsUrl: "https://docs.ted.europa.eu/api/latest/search.html",
  homepage: "https://ted.europa.eu",
  description: "Calls for competition published on TED by public buyers in Norway, Sweden, Denmark, Finland, Germany and France, with buyer identifier, CPV codes, deadline and submission URL.",
  limitations: "TED does not mark a notice closed; activity follows the published deadline and TED's ACTIVE scope. Cancellations are separate change notices and are not linked automatically.",
  capabilities: { incremental: true, pagination: true, publishedAt: true, updatedAt: false, deadline: true, removalDetection: "DEADLINE_ONLY", activityCheck: true, employerIdentity: "REGISTRATION_NUMBER", contacts: true, webhooks: false, directApplyLink: true },
  evidence: "REAL_DATA_TESTED",
  freshnessNote: "TED publishes once per working day; polling more often does not make it fresher.",
  recommendedIntervalMinutes: 360,
  settingFields: [
    { key: "cpv", label: "CPV codes (subtree match)", kind: "list", defaultValue: DEFAULT_CPV.join(", "), help: "72 = IT services, 48 = software, 7934 = marketing, 794 = consulting, 796 = recruitment, 7931 = market research." },
    { key: "formTypes", label: "Notice form types", kind: "list", defaultValue: "competition", help: "competition = calls for tender; add planning to include prior information notices." },
    { key: "countries", label: "Buyer countries", kind: "list", defaultValue: TED_COUNTRIES.join(", "), help: "ISO codes among NO, SE, DK, FI, DE, FR." },
    { key: "initialDays", label: "Initial backfill (days)", kind: "number", defaultValue: 7, help: "How far back the first run reads." },
  ],
  isConfigured: () => ({ ok: true, missing: [] }),
  async fetch(ctx: FetchContext): Promise<FetchResult> {
    const cpv = list(ctx.feed.settings, "cpv", DEFAULT_CPV).filter((c) => /^\d{8}$/.test(c));
    const forms = list(ctx.feed.settings, "formTypes", ["competition"]).filter((f) => /^[a-z-]+$/.test(f));
    const iso3 = list(ctx.feed.settings, "countries", TED_COUNTRIES)
      .map((c) => OPPORTUNITY_COUNTRIES.find((x) => x.code === c.toUpperCase())?.iso3)
      .filter((x): x is string => !!x && x !== "GBR");
    const days = Math.min(Math.max(Number(ctx.feed.settings.initialDays ?? 7), 1), 60);
    // Cursor "YYYYMMDD" or "YYYYMMDD:page": walk publication days in order, one day per query with
    // stable page-number pagination, so a capped run resumes exactly where it stopped. The current
    // day is re-read on the next run (TED may still add notices to it) — ingestion is idempotent.
    const today = tedDay(new Date());
    const [cursorDay, cursorPage] = (ctx.cursor ?? "").split(":");
    let day = /^\d{8}$/.test(cursorDay ?? "") ? cursorDay! : tedDay(new Date(Date.now() - days * 86_400_000));
    let page = Math.max(1, Number(cursorPage) || 1);
    const items: NormalizedOpportunity[] = [];
    const nextDay = (d: string) => tedDay(new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)) + 1)));
    for (;;) {
      if (items.length >= ctx.limit) return { items: items.filter((i) => i.countryCode), outOfScope: items.filter((i) => !i.countryCode).length, complete: false, cursor: `${day}:${page}` };
      const query = [`buyer-country IN (${iso3.join(" ")})`, `publication-date=${day}`, `form-type IN (${forms.join(" ")})`, cpv.length ? `classification-cpv IN (${cpv.join(" ")})` : ""].filter(Boolean).join(" AND ");
      const body = { query, fields: FIELDS, limit: 100, page, paginationMode: "PAGE_NUMBER", scope: "ALL" };
      const res = await http.json<{ notices?: TedNotice[] }>(URL_SEARCH, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" }, signal: ctx.signal });
      const batch = res.notices ?? [];
      items.push(...batch.map(normalizeTedNotice));
      if (batch.length === 100) {
        page++;
        continue;
      }
      if (day >= today) break;
      day = nextDay(day);
      page = 1;
    }
    return { items: items.filter((i) => i.countryCode), outOfScope: items.filter((i) => !i.countryCode).length, complete: true, cursor: today };
  },
  async checkActivity(item): Promise<ActivityCheckResult> {
    try {
      const body = { query: `publication-number=${item.externalId}`, fields: ["publication-number", "deadline-receipt-tender-date-lot"], limit: 1, scope: "ACTIVE" };
      const res = await http.json<{ notices?: TedNotice[] }>(URL_SEARCH, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
      if (res.notices?.length) {
        const deadlines = arr(res.notices[0]!["deadline-receipt-tender-date-lot"]).sort();
        return { status: "ACTIVE", detail: "TED lists the notice in its ACTIVE scope.", deadline: parseDeadline(deadlines[0]).deadline };
      }
      // Not in ACTIVE scope: expired or withdrawn — TED does not say which.
      return { status: "UNKNOWN", detail: "TED no longer lists the notice as active (deadline passed or changed); closure reason not published in search." };
    } catch (e) {
      return { status: "UNKNOWN", detail: e instanceof ProviderHttpError ? e.message : "Status check failed", failed: true };
    }
  },
};
