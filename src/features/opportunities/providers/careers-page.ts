import "server-only";
import { fetchPublicPage } from "@/features/intelligence/safe-fetch";
import { detectCountry } from "@/config/opportunity-countries";
import { cleanUrl, decodeEntities, hostOf, htmlToText, parseDeadline, parseSourceDate, registrableDomain, safeUrl, sha1, uniq } from "../normalize";
import type { ActivityCheckResult, FetchContext, NormalizedOpportunity, OpportunityProvider } from "./types";

/**
 * Official careers page on the employer's own domain, read through schema.org
 * JobPosting structured data (JSON-LD) — the standard employers publish for search
 * engines. No layout scraping and no guessing: a page without JobPosting data
 * yields nothing. robots.txt is respected and only public hosts are fetched.
 *
 * Crawl scope: the configured page, plus up to `maxDetailPages` same-domain links
 * that look like job pages (many sites put JobPosting data only on detail pages).
 */

type JsonLd = Record<string, unknown>;
const JOB_LINK_RE = /(job|jobs|career|careers|position|vacanc|stilling|stillinger|jobb|lediga|tyopaikat|avoimet|stelle|stellen|emploi|offre|recrut)/i;

function asArray<T>(v: T | T[] | undefined | null): T[] {
  return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
}

function str(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object" && "name" in (v as JsonLd)) return str((v as JsonLd).name);
  return undefined;
}

/** Extract every JobPosting object from the page's JSON-LD blocks (incl. @graph and ItemList). */
export function extractJobPostings(html: string): JsonLd[] {
  const out: JsonLd[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const obj = node as JsonLd;
    const type = asArray(obj["@type"] as string | string[]).map(String);
    if (type.includes("JobPosting")) out.push(obj);
    if (obj["@graph"]) visit(obj["@graph"]);
    if (obj.itemListElement) asArray(obj.itemListElement).forEach((i) => visit((i as JsonLd).item ?? i));
  };
  while ((m = re.exec(html))) {
    try {
      visit(JSON.parse(m[1]!.trim()));
    } catch {
      /* malformed JSON-LD block — ignored, never guessed */
    }
  }
  return out;
}

function jobLinks(html: string, base: URL, max: number): string[] {
  const links: string[] = [];
  const re = /<a\s[^>]*href=["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && links.length < max * 4) {
    const u = safeUrl(new URL(decodeEntities(m[1]!), base).toString());
    if (!u || registrableDomain(u.hostname) !== registrableDomain(base.hostname)) continue;
    if (!JOB_LINK_RE.test(u.pathname) || u.pathname.replace(/\/+$/, "") === base.pathname.replace(/\/+$/, "")) continue;
    links.push(u.toString());
  }
  return uniq(links).slice(0, max);
}

function toOpportunity(job: JsonLd, pageUrl: string, employer: { name?: string; website?: string; registrationNumber?: string; registrationCountry?: string }): NormalizedOpportunity | null {
  const title = str(job.title);
  if (!title) return null;
  const org = (job.hiringOrganization ?? {}) as JsonLd;
  const locations = asArray(job.jobLocation as JsonLd | JsonLd[]).map((l) => (l?.address ?? {}) as JsonLd);
  const countries = locations.map((a) => str(a.addressCountry));
  const cities = locations.map((a) => str(a.addressLocality));
  const url = cleanUrl(str(job.url) ?? pageUrl) ?? pageUrl;
  const identifier = job.identifier as JsonLd | string | undefined;
  const ident = typeof identifier === "object" ? str(identifier?.value) : str(identifier);
  const { deadline, deadlineText } = parseDeadline(str(job.validThrough));
  return {
    externalId: ident ? `id:${ident}` : `url:${sha1(url)}`,
    type: "HIRING",
    title,
    organization: { ...employer, name: employer.name ?? str(org.name) },
    countryCode: detectCountry(...countries, ...cities),
    location: uniq([...cities, ...countries]).join(", ") || undefined,
    summary: htmlToText(str(job.description)),
    sourceUrl: url,
    applyUrl: url,
    sourceClass: "OFFICIAL_EMPLOYER_SOURCE",
    sourcePublisher: hostOf(url) ?? "Employer careers page",
    publishedAt: parseSourceDate(str(job.datePosted)),
    deadline,
    deadlineText,
    sourceSaysActive: deadline ? deadline.getTime() > Date.now() : true,
    employmentType: asArray(job.employmentType as string | string[]).join(", ") || undefined,
    jobCategory: str(job.occupationalCategory) ?? str(job.industry),
  };
}

export const careersPageProvider: OpportunityProvider = {
  id: "careers-page",
  name: "Official careers pages (JobPosting data)",
  publisher: "Employer's own website",
  type: "HIRING",
  defaultSourceClass: "OFFICIAL_EMPLOYER_SOURCE",
  perEmployer: true,
  employerScoped: true,
  coverage: [],
  access: { type: "OPEN", requiredEnv: [], termsNote: "Reads public pages on the employer's own domain; robots.txt is respected, no login walls or CAPTCHAs are bypassed." },
  docsUrl: "https://schema.org/JobPosting",
  homepage: "https://schema.org/JobPosting",
  description: "Reads schema.org JobPosting structured data published on the employer's official careers page (and linked job pages on the same domain).",
  limitations: "Only works where the employer publishes JobPosting structured data. Pages rendered entirely by JavaScript or blocked by robots.txt yield nothing.",
  capabilities: { incremental: false, pagination: false, publishedAt: true, updatedAt: false, deadline: true, removalDetection: "LISTING_DIFF", activityCheck: true, employerIdentity: "OFFICIAL_DOMAIN", contacts: false, webhooks: false, directApplyLink: true },
  evidence: "DOCUMENTED_NOT_TESTED",
  freshnessNote: "Polled; reflects the page at fetch time.",
  recommendedIntervalMinutes: 360,
  feedConfigFields: [
    { key: "careersUrl", label: "Careers page URL (official domain)", placeholder: "https://www.acme.com/careers", required: true },
    { key: "employerName", label: "Employer name", required: true },
    { key: "employerWebsite", label: "Employer official website", placeholder: "https://www.acme.com", required: true },
    { key: "registrationNumber", label: "Company registration number", help: "Optional: links the employer to Company Intelligence reliably." },
    { key: "registrationCountry", label: "Registration country (ISO code)", placeholder: "SE" },
  ],
  settingFields: [],
  isConfigured: () => ({ ok: true, missing: [] }),
  validateFeedConfig(c) {
    const careersUrl = cleanUrl(String(c.careersUrl ?? ""));
    const employerWebsite = cleanUrl(/^https?:\/\//i.test(String(c.employerWebsite ?? "")) ? String(c.employerWebsite) : `https://${String(c.employerWebsite ?? "")}`);
    const employerName = String(c.employerName ?? "").trim();
    if (!careersUrl) throw new Error("Enter the careers page URL.");
    if (!employerWebsite) throw new Error("Enter the employer's official website.");
    if (!employerName) throw new Error("Employer name is required.");
    if (registrableDomain(hostOf(careersUrl)) !== registrableDomain(hostOf(employerWebsite))) throw new Error("The careers page must be on the employer's official domain. Use an ATS feed for externally hosted boards.");
    return { careersUrl, employerWebsite, employerName, registrationNumber: c.registrationNumber ? String(c.registrationNumber).trim() : undefined, registrationCountry: c.registrationCountry ? String(c.registrationCountry).trim().toUpperCase().slice(0, 2) : undefined };
  },
  async fetch(ctx: FetchContext) {
    const cfg = ctx.feed.config as { careersUrl: string; employerName?: string; employerWebsite?: string; registrationNumber?: string; registrationCountry?: string };
    const employer = { name: cfg.employerName, website: cfg.employerWebsite, registrationNumber: cfg.registrationNumber, registrationCountry: cfg.registrationCountry };
    const page = await fetchPublicPage(cfg.careersUrl, { timeoutMs: 15_000 });
    if ("error" in page) throw new Error(`Careers page could not be read: ${page.error}`);
    if (page.status >= 400) throw new Error(`Careers page responded ${page.status}`);
    const found = new Map<string, NormalizedOpportunity>();
    const add = (html: string, url: string) => {
      for (const job of extractJobPostings(html)) {
        const o = toOpportunity(job, url, employer);
        if (o) found.set(o.externalId, o);
      }
    };
    add(page.html, page.url);
    let complete = true;
    const max = Math.min(Number(ctx.feed.settings.maxDetailPages ?? 20), 40);
    for (const link of jobLinks(page.html, new URL(page.url), max)) {
      if (found.size >= ctx.limit) {
        complete = false;
        break;
      }
      const detail = await fetchPublicPage(link, { timeoutMs: 12_000 });
      if ("error" in detail) {
        ctx.log(`skipped ${link}: ${detail.error}`);
        complete = false; // a page we could not read means the listing is not provably complete
        continue;
      }
      if (detail.status < 400) add(detail.html, detail.url);
    }
    const items = [...found.values()];
    const inScope = items.filter((i) => i.countryCode);
    return { items: inScope, outOfScope: items.length - inScope.length, complete, fullListing: complete, cursor: null };
  },
  async checkActivity(item): Promise<ActivityCheckResult> {
    if (!item.sourceUrl) return { status: "UNKNOWN", detail: "No posting URL to check." };
    const page = await fetchPublicPage(item.sourceUrl, { timeoutMs: 12_000 });
    if ("error" in page) return { status: "UNKNOWN", detail: `Page could not be read: ${page.error}`, failed: true };
    if (page.status === 404 || page.status === 410) return { status: "REMOVED", detail: `Posting page responded ${page.status}.` };
    if (page.status >= 400) return { status: "UNKNOWN", detail: `Posting page responded ${page.status}.`, failed: page.status >= 500 };
    const jobs = extractJobPostings(page.html);
    if (!jobs.length) return { status: "UNKNOWN", detail: "Page reachable but no JobPosting data found; activity cannot be confirmed." };
    const { deadline } = parseDeadline(str(jobs[0]!.validThrough));
    // A passed validThrough is a deadline (→ EXPIRED), not a removal; the engine derives that from `deadline`.
    return { status: "ACTIVE", detail: deadline && deadline.getTime() < Date.now() ? "JobPosting data still published, but its validThrough date has passed." : "JobPosting data still published on the page.", deadline };
  },
};
