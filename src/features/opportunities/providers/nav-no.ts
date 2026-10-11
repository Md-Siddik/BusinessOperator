import "server-only";
import { createHttpClient, ProviderHttpError } from "@/features/registry/http";
import { cleanUrl, htmlToText, normalizeRegNumber, parseDeadline, parseSourceDate, uniq } from "../normalize";
import type { ActivityCheckResult, FetchContext, FetchResult, NormalizedContact, NormalizedOpportunity, OpportunityProvider } from "./types";

/**
 * Norway — NAV "Arbeidsplassen" job vacancy feed (pam-stilling-feed).
 * Built from NAV's published OpenAPI spec (https://pam-stilling-feed.nav.no/api/openapi.json):
 *   GET /api/v1/feed[?last=true]          first / last feed page (JSON Feed + _feed_entry)
 *   GET /api/v1/feed/{feedPageId}         a page (next_url / next_id chain)
 *   GET /api/v1/feedentry/{entryId}       one ad: { status, sistEndret, ad_content }
 * Auth: "Authorization: Bearer <token>". NAV's rotating public token is for experiments only
 * (and failed during development); production use requires a consumer token from NAV
 * (email nav.team.arbeidsplassen@nav.no, accepting https://arbeidsplassen.nav.no/vilkar-api).
 * Terms: inactive ads must be removed — this provider purges content on INACTIVE.
 */
const BASE = process.env.NAV_JOB_FEED_URL || "https://pam-stilling-feed.nav.no";
const http = createHttpClient({ name: "NAV job vacancy feed", minIntervalMs: 300, timeoutMs: 30_000 });

type FeedPage = { id?: string; next_url?: string | null; next_id?: string | null; items: { id: string; url: string; title?: string; date_modified?: string; _feed_entry?: { uuid: string; status: "ACTIVE" | "INACTIVE"; title?: string; businessName?: string; municipal?: string; sistEndret?: string } }[] };
type FeedAd = {
  uuid: string;
  published?: string;
  expires?: string;
  updated?: string;
  workLocations?: { country?: string; city?: string; county?: string; municipal?: string }[];
  contactList?: { name?: string; email?: string; phone?: string; role?: string; title?: string }[];
  title?: string;
  description?: string;
  sourceurl?: string;
  source?: string;
  applicationUrl?: string;
  applicationDue?: string;
  occupationCategories?: { level1?: string; level2?: string }[];
  jobtitle?: string;
  link?: string;
  employer?: { name?: string; orgnr?: string; homepage?: string };
  engagementtype?: string;
  extent?: string;
};
type FeedEntryContent = { uuid: string; status: "ACTIVE" | "INACTIVE"; sistEndret?: string; ad_content?: FeedAd };

function token() {
  return process.env.NAV_JOB_FEED_TOKEN?.trim();
}
function headers() {
  return { Authorization: `Bearer ${token()}` };
}

function normalize(ad: FeedAd): NormalizedOpportunity {
  const contacts: NormalizedContact[] = (ad.contactList ?? [])
    .filter((c) => c.name || c.email || c.phone)
    .map((c) => ({ kind: "NAMED_PERSON" as const, name: c.name, role: c.title ?? c.role, email: c.email, phone: c.phone }));
  if (ad.employer?.homepage) contacts.push({ kind: "ORGANIZATION_WEBSITE", url: cleanUrl(ad.employer.homepage) });
  const applyUrl = cleanUrl(ad.applicationUrl);
  if (applyUrl) contacts.push({ kind: "APPLICATION_LINK", url: applyUrl });
  // applicationDue is free text at NAV (often an ISO date, sometimes "Snarest") — never forced into a date.
  const due = parseDeadline(ad.applicationDue);
  const loc = ad.workLocations?.[0];
  const foreign = loc?.country && !/^(norge|norway|no)$/i.test(loc.country);
  return {
    externalId: ad.uuid,
    type: "HIRING",
    title: ad.title ?? ad.jobtitle ?? "(untitled ad)",
    organization: { name: ad.employer?.name, registrationNumber: normalizeRegNumber(ad.employer?.orgnr), registrationCountry: "NO", website: cleanUrl(ad.employer?.homepage) },
    countryCode: foreign ? undefined : "NO",
    location: uniq([loc?.city ?? loc?.municipal, loc?.county]).join(", ") || undefined,
    summary: htmlToText(ad.description),
    sourceUrl: cleanUrl(ad.link) ?? cleanUrl(ad.sourceurl),
    applyUrl,
    sourceClass: "OFFICIAL_PUBLIC_EMPLOYMENT_SERVICE",
    sourcePublisher: `NAV Arbeidsplassen${ad.source ? ` (source: ${ad.source})` : ""}`,
    publishedAt: parseSourceDate(ad.published),
    sourceUpdatedAt: parseSourceDate(ad.updated),
    ...(due.deadline ? due : due.deadlineText ? { deadlineText: due.deadlineText } : {}),
    sourceSaysActive: true,
    jobCategory: ad.occupationCategories?.[0]?.level2 ?? ad.occupationCategories?.[0]?.level1,
    employmentType: uniq([ad.engagementtype, ad.extent]).join(", ") || undefined,
    classification: { scheme: "NAV occupation category", labels: uniq((ad.occupationCategories ?? []).flatMap((o) => [o.level1, o.level2])) },
    contacts,
  };
}

export const navProvider: OpportunityProvider = {
  id: "nav-no",
  name: "NAV Arbeidsplassen — job vacancy feed",
  publisher: "NAV (Norwegian Labour and Welfare Administration)",
  type: "HIRING",
  defaultSourceClass: "OFFICIAL_PUBLIC_EMPLOYMENT_SERVICE",
  perEmployer: false,
  coverage: [{ code: "NO", level: "NATIONAL_OFFICIAL", note: "Vacancies published on Arbeidsplassen (NAV), including ads imported from other Norwegian boards." }],
  access: {
    type: "TOKEN_ON_REQUEST",
    requiredEnv: ["NAV_JOB_FEED_TOKEN"],
    signupUrl: "https://navikt.github.io/pam-stilling-feed/",
    termsUrl: "https://arbeidsplassen.nav.no/vilkar-api",
    termsNote: "Free; request a consumer token from nav.team.arbeidsplassen@nav.no after accepting the terms. Inactive ads must be removed from your service.",
  },
  docsUrl: "https://navikt.github.io/pam-stilling-feed/",
  homepage: "https://arbeidsplassen.nav.no",
  description: "Norwegian vacancies with employer name and organisasjonsnummer, contact persons, application URL and ACTIVE/INACTIVE status per ad.",
  limitations: "Application deadline is free text at NAV (e.g. “Snarest”) and is shown as published. Ads can originate from other boards (shown as source).",
  capabilities: { incremental: true, pagination: true, publishedAt: true, updatedAt: true, deadline: true, removalDetection: "EXPLICIT", activityCheck: true, employerIdentity: "REGISTRATION_NUMBER", contacts: true, webhooks: false, directApplyLink: false },
  evidence: "DOCUMENTED_NOT_TESTED",
  freshnessNote: "Feed pages are polled with conditional requests; NAV recommends waiting when the end of the feed is reached.",
  recommendedIntervalMinutes: 30,
  purgeOnRemoval: true,
  settingFields: [{ key: "initialDays", label: "Initial backfill (days)", kind: "number", defaultValue: 3, help: "The first run starts this many days back (If-Modified-Since)." }],
  isConfigured: () => (token() ? { ok: true, missing: [] } : { ok: false, missing: ["NAV_JOB_FEED_TOKEN"], message: "Needs a NAV consumer token (free, on request)." }),
  async fetch(ctx: FetchContext): Promise<FetchResult> {
    if (!token()) throw new Error("NAV_JOB_FEED_TOKEN is not set.");
    const items: NormalizedOpportunity[] = [];
    const removedIds: string[] = [];
    let outOfScope = 0;
    let pageUrl: string;
    const init: RequestInit = { headers: headers() };
    if (ctx.cursor) pageUrl = `${BASE}/api/v1/feed/${encodeURIComponent(ctx.cursor)}`;
    else {
      const days = Math.min(Math.max(Number(ctx.feed.settings.initialDays ?? 3), 1), 14);
      pageUrl = `${BASE}/api/v1/feed`;
      init.headers = { ...headers(), "If-Modified-Since": new Date(Date.now() - days * 86_400_000).toUTCString() };
    }
    let cursor = ctx.cursor;
    let complete = true;
    for (let pages = 0; pages < 50; pages++) {
      const res = await http.request(pageUrl, { ...init, signal: ctx.signal });
      if (res.status === 304) break;
      if (res.status === 401 || res.status === 403) throw new ProviderHttpError(`NAV rejected the token (${res.status}).`, res.status);
      if (!res.ok) throw new ProviderHttpError(`NAV feed responded ${res.status}`, res.status, res.status >= 500);
      const page = (await res.json()) as FeedPage;
      for (const line of page.items) {
        const entry = line._feed_entry;
        if (!entry) continue;
        if (entry.status === "INACTIVE") {
          removedIds.push(entry.uuid);
          continue;
        }
        if (items.length >= ctx.limit) {
          complete = false;
          break;
        }
        const detail = await http.json<FeedEntryContent>(`${BASE}/api/v1/feedentry/${encodeURIComponent(entry.uuid)}`, { headers: headers(), signal: ctx.signal });
        if (detail.status === "INACTIVE" || !detail.ad_content) {
          removedIds.push(entry.uuid);
          continue;
        }
        const o = normalize(detail.ad_content);
        if (o.countryCode) items.push(o);
        else outOfScope++;
      }
      if (!complete) break;
      cursor = page.id ?? cursor;
      if (!page.next_id) break; // end of feed: keep polling this page next run
      cursor = page.next_id;
      pageUrl = `${BASE}/api/v1/feed/${encodeURIComponent(page.next_id)}`;
      init.headers = headers();
    }
    return { items, removedIds, outOfScope, complete, cursor };
  },
  async checkActivity(item): Promise<ActivityCheckResult> {
    if (!token()) return { status: "UNKNOWN", detail: "NAV token not configured.", failed: true };
    try {
      const res = await http.request(`${BASE}/api/v1/feedentry/${encodeURIComponent(item.externalId)}`, { headers: headers() });
      if (res.status === 404) return { status: "REMOVED", detail: "NAV reports the feed entry no longer exists (404)." };
      if (!res.ok) return { status: "UNKNOWN", detail: `NAV responded ${res.status}.`, failed: true };
      const e = (await res.json()) as FeedEntryContent;
      return e.status === "ACTIVE" ? { status: "ACTIVE", detail: "NAV reports status ACTIVE." } : { status: "REMOVED", detail: "NAV reports status INACTIVE." };
    } catch (err) {
      return { status: "UNKNOWN", detail: err instanceof ProviderHttpError ? err.message : "Status check failed", failed: true };
    }
  },
};
