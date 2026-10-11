import "server-only";
import { createHttpClient, ProviderHttpError } from "@/features/registry/http";
import { detectCountry } from "@/config/opportunity-countries";
import { cleanUrl, htmlToText, parseSourceDate, uniq } from "../normalize";
import type { ActivityCheckResult, FeedLike, FetchContext, FetchResult, NormalizedOpportunity, OpportunityProvider } from "./types";

/**
 * Public ATS job-board APIs (employer-controlled boards). Each board belongs to
 * one employer and lists that employer's CURRENT open postings, so:
 *  - source class: Official employer ATS
 *  - removal: listing diff (absent from consecutive complete listings) + direct check where available
 * The owner adds boards per employer; ExploreTechify then checks whether the board
 * is linked from the employer's official domain (see verification.ts).
 */

const TOKEN_RE = /^[a-z0-9][a-z0-9_.-]{0,99}$/i;
const ATS_FIELDS = [
  { key: "token", label: "Board token / site name", placeholder: "e.g. acme", required: true, help: "The identifier in the public board URL." },
  { key: "employerName", label: "Employer name", required: true },
  { key: "employerWebsite", label: "Employer official website", placeholder: "https://www.acme.com", required: true, help: "Used to verify that the board is linked from the employer's own domain." },
  { key: "careersUrl", label: "Careers page on the official domain", placeholder: "https://www.acme.com/careers", help: "Optional: page expected to link to the board." },
  { key: "registrationNumber", label: "Company registration number", help: "Optional: links the employer to Company Intelligence reliably." },
  { key: "registrationCountry", label: "Registration country (ISO code)", placeholder: "NO" },
];

function validateAtsConfig(config: Record<string, unknown>) {
  const token = String(config.token ?? "").trim();
  if (!TOKEN_RE.test(token)) throw new Error("Enter the board token exactly as it appears in the public board URL (letters, digits, - _ .).");
  const employerName = String(config.employerName ?? "").trim();
  if (!employerName) throw new Error("Employer name is required.");
  const employerWebsite = cleanUrl(/^https?:\/\//i.test(String(config.employerWebsite ?? "")) ? String(config.employerWebsite) : `https://${String(config.employerWebsite ?? "")}`);
  if (!employerWebsite) throw new Error("Enter the employer's official website.");
  const careersUrl = config.careersUrl ? cleanUrl(String(config.careersUrl)) : undefined;
  const registrationNumber = config.registrationNumber ? String(config.registrationNumber).trim() : undefined;
  const registrationCountry = config.registrationCountry ? String(config.registrationCountry).trim().toUpperCase().slice(0, 2) : undefined;
  return { token, employerName, employerWebsite, careersUrl, registrationNumber, registrationCountry };
}

function employerOf(feed: FeedLike) {
  const c = feed.config as { employerName?: string; registrationNumber?: string; registrationCountry?: string; employerWebsite?: string };
  return { name: c.employerName, registrationNumber: c.registrationNumber, registrationCountry: c.registrationCountry, website: c.employerWebsite };
}

function scope(items: NormalizedOpportunity[]): FetchResult {
  const inScope = items.filter((i) => i.countryCode);
  return { items: inScope, outOfScope: items.length - inScope.length, complete: true, fullListing: true, cursor: null };
}

async function statusCheck(http: ReturnType<typeof createHttpClient>, url: string, notFoundMeansRemoved: (body: string) => boolean): Promise<ActivityCheckResult> {
  try {
    const res = await http.request(url);
    if (res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { status: "ACTIVE", detail: `Source returned ${res.status} for the posting.` };
    }
    const body = await res.text().catch(() => "");
    if (res.status === 404 && notFoundMeansRemoved(body)) return { status: "REMOVED", detail: "Source reports the posting no longer exists (404)." };
    return { status: "UNKNOWN", detail: `Source responded ${res.status}; activity not determined.`, failed: res.status >= 500 || res.status === 429 };
  } catch (e) {
    return { status: "UNKNOWN", detail: e instanceof ProviderHttpError ? e.message : "Status check failed", failed: true };
  }
}

/* ───────────── Greenhouse ───────────── */

const greenhouseHttp = createHttpClient({ name: "Greenhouse Job Board API", minIntervalMs: 500 });
type GhJob = {
  id: number;
  title: string;
  absolute_url: string;
  updated_at?: string;
  first_published?: string;
  location?: { name?: string };
  offices?: { name?: string; location?: string }[];
  departments?: { name?: string }[];
  content?: string;
  company_name?: string;
  application_deadline?: string | null;
};

export const greenhouseProvider: OpportunityProvider = {
  id: "greenhouse",
  name: "Greenhouse job boards",
  publisher: "Greenhouse Software (employer-hosted boards)",
  type: "HIRING",
  defaultSourceClass: "OFFICIAL_EMPLOYER_ATS",
  perEmployer: true,
  employerScoped: true,
  coverage: [],
  access: { type: "OPEN", requiredEnv: [], termsUrl: "https://developers.greenhouse.io/job-board.html", termsNote: "Public Job Board API (GET endpoints need no key). Boards are published by the employers themselves." },
  docsUrl: "https://developers.greenhouse.io/job-board.html",
  homepage: "https://www.greenhouse.com",
  description: "Lists every open posting on an employer's public Greenhouse board, with first-published and updated timestamps.",
  limitations: "Location is free text; postings outside the supported countries are skipped. Only boards the owner adds are monitored.",
  capabilities: { incremental: false, pagination: false, publishedAt: true, updatedAt: true, deadline: true, removalDetection: "LISTING_DIFF", activityCheck: true, employerIdentity: "ATS_BOARD_OWNER", contacts: false, webhooks: false, directApplyLink: true },
  evidence: "REAL_DATA_TESTED",
  freshnessNote: "Polled; the board API serves the live board on request.",
  recommendedIntervalMinutes: 180,
  feedConfigFields: ATS_FIELDS,
  isConfigured: () => ({ ok: true, missing: [] }),
  validateFeedConfig: validateAtsConfig,
  async fetch(ctx: FetchContext) {
    const token = String(ctx.feed.config.token);
    const data = await greenhouseHttp.json<{ jobs: GhJob[] }>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`, { signal: ctx.signal });
    const employer = employerOf(ctx.feed);
    const items = data.jobs.slice(0, ctx.limit).map<NormalizedOpportunity>((j) => {
      const loc = j.location?.name;
      return {
        externalId: String(j.id),
        type: "HIRING",
        title: j.title,
        organization: { ...employer, name: employer.name ?? j.company_name },
        countryCode: detectCountry(loc, ...(j.offices ?? []).map((o) => o.location ?? o.name)),
        location: loc,
        summary: htmlToText(j.content),
        sourceUrl: cleanUrl(j.absolute_url),
        applyUrl: cleanUrl(j.absolute_url),
        sourceClass: "OFFICIAL_EMPLOYER_ATS",
        sourcePublisher: `Greenhouse board “${token}”`,
        publishedAt: parseSourceDate(j.first_published),
        sourceUpdatedAt: parseSourceDate(j.updated_at),
        ...(j.application_deadline ? { deadline: parseSourceDate(j.application_deadline) } : {}),
        sourceSaysActive: true,
        jobCategory: uniq((j.departments ?? []).map((d) => d.name))[0],
        classification: { scheme: "Greenhouse department", labels: uniq((j.departments ?? []).map((d) => d.name)) },
      };
    });
    const res = scope(items);
    if (data.jobs.length > ctx.limit) return { ...res, complete: false, fullListing: false };
    return res;
  },
  checkActivity: (item, feed) => statusCheck(greenhouseHttp, `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(String(feed.config.token))}/jobs/${encodeURIComponent(item.externalId)}`, (b) => /job not found/i.test(b)),
};

/* ───────────── Lever ───────────── */

const leverHttp = createHttpClient({ name: "Lever Postings API", minIntervalMs: 500 });
type LeverPosting = {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number;
  country?: string;
  workplaceType?: string;
  descriptionPlain?: string;
  categories?: { location?: string; allLocations?: string[]; team?: string; department?: string; commitment?: string };
};

function leverBase(feed: FeedLike) {
  return feed.config.region === "eu" ? "https://api.eu.lever.co" : "https://api.lever.co";
}

export const leverProvider: OpportunityProvider = {
  id: "lever",
  name: "Lever job boards",
  publisher: "Lever (employer-hosted boards)",
  type: "HIRING",
  defaultSourceClass: "OFFICIAL_EMPLOYER_ATS",
  perEmployer: true,
  employerScoped: true,
  coverage: [],
  access: { type: "OPEN", requiredEnv: [], termsUrl: "https://github.com/lever/postings-api", termsNote: "Public Postings API for published job postings; no key required." },
  docsUrl: "https://github.com/lever/postings-api",
  homepage: "https://www.lever.co",
  description: "Lists an employer's published Lever postings, including an ISO country code and creation time.",
  limitations: "Lever exposes no update timestamp or closing date. Postings outside the supported countries are skipped.",
  capabilities: { incremental: false, pagination: true, publishedAt: true, updatedAt: false, deadline: false, removalDetection: "LISTING_DIFF", activityCheck: true, employerIdentity: "ATS_BOARD_OWNER", contacts: false, webhooks: false, directApplyLink: true },
  evidence: "REAL_DATA_TESTED",
  freshnessNote: "Polled; the postings API serves the live board on request.",
  recommendedIntervalMinutes: 180,
  feedConfigFields: [...ATS_FIELDS, { key: "region", label: "Lever region", placeholder: "global or eu", help: "Use “eu” for boards hosted on jobs.eu.lever.co." }],
  isConfigured: () => ({ ok: true, missing: [] }),
  validateFeedConfig: (c) => ({ ...validateAtsConfig(c), region: c.region === "eu" ? "eu" : "global" }),
  async fetch(ctx: FetchContext) {
    const site = String(ctx.feed.config.token);
    const employer = employerOf(ctx.feed);
    const all: LeverPosting[] = [];
    const page = 100;
    for (let skip = 0; skip < ctx.limit; skip += page) {
      const batch = await leverHttp.json<LeverPosting[]>(`${leverBase(ctx.feed)}/v0/postings/${encodeURIComponent(site)}?mode=json&skip=${skip}&limit=${page}`, { signal: ctx.signal });
      all.push(...batch);
      if (batch.length < page) break;
    }
    const items = all.map<NormalizedOpportunity>((p) => ({
      externalId: p.id,
      type: "HIRING",
      title: p.text,
      organization: employer,
      countryCode: detectCountry(p.country, p.categories?.location, ...(p.categories?.allLocations ?? [])),
      location: p.categories?.location,
      summary: p.descriptionPlain ? p.descriptionPlain.slice(0, 4000) : undefined,
      sourceUrl: cleanUrl(p.hostedUrl),
      applyUrl: cleanUrl(p.applyUrl ?? p.hostedUrl),
      sourceClass: "OFFICIAL_EMPLOYER_ATS",
      sourcePublisher: `Lever site “${site}”`,
      publishedAt: parseSourceDate(p.createdAt),
      sourceSaysActive: true,
      jobCategory: p.categories?.department ?? p.categories?.team,
      employmentType: p.categories?.commitment,
      classification: { scheme: "Lever team", labels: uniq([p.categories?.department, p.categories?.team]) },
    }));
    const res = scope(items);
    return all.length >= ctx.limit ? { ...res, complete: false, fullListing: false } : res;
  },
  checkActivity: (item, feed) => statusCheck(leverHttp, `${leverBase(feed)}/v0/postings/${encodeURIComponent(String(feed.config.token))}/${encodeURIComponent(item.externalId)}`, () => true),
};

/* ───────────── Ashby ───────────── */

const ashbyHttp = createHttpClient({ name: "Ashby Job Posting API", minIntervalMs: 500 });
type AshbyJob = {
  id: string;
  title: string;
  department?: string;
  team?: string;
  employmentType?: string;
  location?: string;
  secondaryLocations?: { location?: string; address?: { postalAddress?: { addressCountry?: string } } }[];
  publishedAt?: string;
  isListed?: boolean;
  address?: { postalAddress?: { addressCountry?: string; addressLocality?: string } };
  jobUrl: string;
  applyUrl?: string;
  descriptionPlain?: string;
};

export const ashbyProvider: OpportunityProvider = {
  id: "ashby",
  name: "Ashby job boards",
  publisher: "Ashby (employer-hosted boards)",
  type: "HIRING",
  defaultSourceClass: "OFFICIAL_EMPLOYER_ATS",
  perEmployer: true,
  employerScoped: true,
  coverage: [],
  access: { type: "OPEN", requiredEnv: [], termsUrl: "https://developers.ashbyhq.com/docs/public-job-posting-api", termsNote: "Public job posting API for an organization's published job board; no key required." },
  docsUrl: "https://developers.ashbyhq.com/docs/public-job-posting-api",
  homepage: "https://www.ashbyhq.com",
  description: "Lists an employer's listed Ashby postings with publication time and structured address.",
  limitations: "No per-posting status endpoint; removal is detected only by absence from consecutive complete listings. No closing date.",
  capabilities: { incremental: false, pagination: false, publishedAt: true, updatedAt: false, deadline: false, removalDetection: "LISTING_DIFF", activityCheck: false, employerIdentity: "ATS_BOARD_OWNER", contacts: false, webhooks: false, directApplyLink: true },
  evidence: "REAL_DATA_TESTED",
  freshnessNote: "Polled; the posting API serves the live board on request.",
  recommendedIntervalMinutes: 180,
  feedConfigFields: ATS_FIELDS,
  isConfigured: () => ({ ok: true, missing: [] }),
  validateFeedConfig: validateAtsConfig,
  async fetch(ctx: FetchContext) {
    const name = String(ctx.feed.config.token);
    const data = await ashbyHttp.json<{ jobs: AshbyJob[] }>(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(name)}?includeCompensation=false`, { signal: ctx.signal });
    const employer = employerOf(ctx.feed);
    const listed = data.jobs.filter((j) => j.isListed !== false);
    const items = listed.slice(0, ctx.limit).map<NormalizedOpportunity>((j) => ({
      externalId: j.id,
      type: "HIRING",
      title: j.title,
      organization: employer,
      countryCode: detectCountry(j.address?.postalAddress?.addressCountry, j.location, ...(j.secondaryLocations ?? []).map((s) => s.address?.postalAddress?.addressCountry ?? s.location)),
      location: j.location,
      summary: j.descriptionPlain ? j.descriptionPlain.slice(0, 4000) : undefined,
      sourceUrl: cleanUrl(j.jobUrl),
      applyUrl: cleanUrl(j.applyUrl ?? j.jobUrl),
      sourceClass: "OFFICIAL_EMPLOYER_ATS",
      sourcePublisher: `Ashby board “${name}”`,
      publishedAt: parseSourceDate(j.publishedAt),
      sourceSaysActive: true,
      jobCategory: j.department ?? j.team,
      employmentType: j.employmentType,
      classification: { scheme: "Ashby department", labels: uniq([j.department, j.team]) },
    }));
    const res = scope(items);
    return listed.length > ctx.limit ? { ...res, complete: false, fullListing: false } : res;
  },
};
