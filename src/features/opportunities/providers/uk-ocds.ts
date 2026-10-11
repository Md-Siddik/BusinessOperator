import "server-only";
import { createHttpClient, ProviderHttpError } from "@/features/registry/http";
import { cleanUrl, emailDomain, hostOf, normalizeRegNumber, parseDeadline, parseSourceDate, registrableDomain, truncate, uniq } from "../normalize";
import type { ActivityCheckResult, FetchContext, FetchResult, NormalizedContact, NormalizedOpportunity, OpportunityProvider } from "./types";

/**
 * United Kingdom — official open-contracting (OCDS) publications, Open Government Licence v3:
 *   Find a Tender (FTS)   https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages
 *                          ?stages=tender&updatedFrom=…  (cursor pagination via links.next)
 *   Contracts Finder (CF) https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search
 *                          ?stages=tender&publishedFrom=…  (cursor pagination via links.next)
 * Both checked against live data. A notice's contact point can be a procurement agent
 * acting for the buyer — such contacts are flagged as third-party.
 */
type Party = { id?: string; name?: string; roles?: string[]; identifier?: { scheme?: string; id?: string; legalName?: string }; contactPoint?: { name?: string; email?: string; telephone?: string; url?: string }; details?: { url?: string } };
type Release = {
  id: string;
  ocid: string;
  date?: string;
  tag?: string[];
  tender?: {
    id?: string;
    title?: string;
    description?: string;
    status?: string;
    datePublished?: string;
    classification?: { scheme?: string; id?: string; description?: string };
    additionalClassifications?: { scheme?: string; id?: string; description?: string }[];
    items?: { additionalClassifications?: { scheme?: string; id?: string; description?: string }[] }[];
    tenderPeriod?: { endDate?: string };
    submissionMethodDetails?: string;
    documents?: { documentType?: string; url?: string }[];
  };
  parties?: Party[];
  buyer?: { id?: string; name?: string };
  links?: { rel?: string; href?: string }[];
};
type Package = { releases?: Release[]; links?: { next?: string } };

function cpvCodes(t: Release["tender"]) {
  const all = [t?.classification, ...(t?.additionalClassifications ?? []), ...(t?.items ?? []).flatMap((i) => i.additionalClassifications ?? [])];
  return {
    codes: uniq(all.filter((c) => c?.scheme === "CPV").map((c) => c!.id)),
    labels: uniq(all.filter((c) => c?.scheme === "CPV").map((c) => c!.description)),
  };
}

function inCpvScope(codes: string[], prefixes: string[]) {
  if (!prefixes.length) return true;
  const trimmed = prefixes.map((p) => p.replace(/0+$/, ""));
  return codes.some((c) => trimmed.some((p) => c.startsWith(p)));
}

function normalizeRelease(r: Release, publisher: string, noticeUrl: (r: Release) => string | undefined): NormalizedOpportunity {
  const t = r.tender ?? {};
  const buyer = r.parties?.find((p) => p.roles?.includes("buyer")) ?? r.parties?.find((p) => p.id === r.buyer?.id);
  const buyerSite = cleanUrl(buyer?.details?.url);
  const buyerDomain = registrableDomain(hostOf(buyerSite));
  const contacts: NormalizedContact[] = [];
  const cp = buyer?.contactPoint;
  if (cp?.name || cp?.email || cp?.telephone) {
    contacts.push({ kind: cp.name ? "NAMED_PERSON" : "ORGANIZATION_EMAIL", name: cp.name, email: cp.email, phone: cp.telephone });
  }
  if (cp?.url) contacts.push({ kind: "SUBMISSION_LINK", url: cleanUrl(cp.url) });
  if (buyerSite) contacts.push({ kind: "ORGANIZATION_WEBSITE", url: buyerSite });
  // Mark contacts whose email domain differs from the buyer's website (e.g. procurement agents).
  for (const c of contacts) if (c.email && buyerDomain && registrableDomain(emailDomain(c.email)) !== buyerDomain) c.thirdParty = true;
  const cpv = cpvCodes(t);
  const ch = buyer?.identifier?.scheme === "GB-COH" ? normalizeRegNumber(buyer.identifier.id) : undefined;
  const { deadline, deadlineText } = parseDeadline(t.tenderPeriod?.endDate);
  return {
    externalId: r.id,
    type: "PROCUREMENT",
    title: t.title ?? r.id,
    organization: { name: buyer?.name ?? r.buyer?.name, registrationNumber: ch, registrationCountry: ch ? "GB" : undefined, website: buyerSite },
    countryCode: "GB",
    summary: truncate(t.description, 4000),
    sourceUrl: noticeUrl(r),
    applyUrl: cleanUrl(t.submissionMethodDetails && /^https?:/i.test(t.submissionMethodDetails) ? t.submissionMethodDetails : cp?.url),
    sourceClass: "OFFICIAL_PROCUREMENT_PORTAL",
    sourcePublisher: publisher,
    publishedAt: parseSourceDate(t.datePublished ?? r.date),
    deadline,
    deadlineText,
    sourceSaysActive: t.status === "active",
    sourceSaysClosed: t.status === "cancelled" || t.status === "unsuccessful" || t.status === "complete" || t.status === "withdrawn",
    classification: { scheme: "CPV", codes: cpv.codes, labels: cpv.labels },
    noticeKind: "Tender notice",
    contacts,
  };
}

function makeOcdsProvider(opts: {
  id: string;
  name: string;
  publisher: string;
  docsUrl: string;
  homepage: string;
  level: "NATIONAL_OFFICIAL" | "PARTIAL";
  note: string;
  description: string;
  limitations: string;
  firstUrl: (since: Date) => string;
  noticeUrl: (r: Release) => string | undefined;
  checkUrl?: (externalId: string) => string;
}): OpportunityProvider {
  const http = createHttpClient({ name: opts.name, minIntervalMs: 1_000, timeoutMs: 45_000 });
  return {
    id: opts.id,
    name: opts.name,
    publisher: opts.publisher,
    type: "PROCUREMENT",
    defaultSourceClass: "OFFICIAL_PROCUREMENT_PORTAL",
    perEmployer: false,
    coverage: [{ code: "GB", level: opts.level, note: opts.note }],
    access: { type: "OPEN", requiredEnv: [], termsUrl: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/", termsNote: "Open data under the Open Government Licence v3.0; no key required." },
    docsUrl: opts.docsUrl,
    homepage: opts.homepage,
    description: opts.description,
    limitations: opts.limitations,
    capabilities: { incremental: true, pagination: true, publishedAt: true, updatedAt: true, deadline: true, removalDetection: "DEADLINE_ONLY", activityCheck: !!opts.checkUrl, employerIdentity: "NAME_ONLY", contacts: true, webhooks: false, directApplyLink: true },
    evidence: "REAL_DATA_TESTED",
    freshnessNote: "Polled; notices appear when the buyer publishes them.",
    recommendedIntervalMinutes: 120,
    settingFields: [
      { key: "cpv", label: "CPV codes (prefix match)", kind: "list", defaultValue: "72000000, 48000000, 79340000, 79400000, 79600000, 79310000", help: "Empty = all tender notices (large volume)." },
      { key: "initialDays", label: "Initial backfill (days)", kind: "number", defaultValue: 7, help: "How far back the first run reads." },
    ],
    isConfigured: () => ({ ok: true, missing: [] }),
    async fetch(ctx: FetchContext): Promise<FetchResult> {
      const prefixes = String(ctx.feed.settings.cpv ?? "72000000, 48000000, 79340000, 79400000, 79600000, 79310000").split(/[,\s]+/).filter((c) => /^\d{2,8}$/.test(c));
      const days = Math.min(Math.max(Number(ctx.feed.settings.initialDays ?? 7), 1), 60);
      const startedAt = new Date();
      // Cursor = ISO time of the last complete run, or "next:<url>" to resume a capped run at the
      // source's own pagination link (same host only).
      const resume = ctx.cursor?.startsWith("next:") ? ctx.cursor.slice(5) : undefined;
      const sameHost = resume && new URL(resume).host === new URL(opts.firstUrl(new Date())).host;
      const since = ctx.cursor && !resume ? new Date(new Date(ctx.cursor).getTime() - 10 * 60_000) : new Date(Date.now() - days * 86_400_000);
      let url: string | undefined = sameHost ? resume : opts.firstUrl(since);
      const items: NormalizedOpportunity[] = [];
      let outOfScope = 0;
      let seen = 0;
      let complete = true;
      for (let page = 0; url; page++) {
        if (seen >= ctx.limit * 4 || page >= 60) {
          complete = false;
          break;
        }
        const pkg: Package = await http.json<Package>(url, { signal: ctx.signal });
        for (const r of pkg.releases ?? []) {
          seen++;
          if (!r.tag?.includes("tender")) continue;
          const o = normalizeRelease(r, opts.publisher, opts.noticeUrl);
          if (inCpvScope(o.classification?.codes ?? [], prefixes)) items.push(o);
          else outOfScope++;
        }
        url = pkg.releases?.length ? pkg.links?.next : undefined;
      }
      return { items, outOfScope, complete, cursor: complete ? startedAt.toISOString() : url ? `next:${url}` : (ctx.cursor ?? null) };
    },
    ...(opts.checkUrl && {
      async checkActivity(item: { externalId: string }): Promise<ActivityCheckResult> {
        try {
          const res = await http.request(opts.checkUrl!(item.externalId));
          if (res.status === 404) return { status: "REMOVED", detail: "The notice is no longer published (404)." };
          if (!res.ok) return { status: "UNKNOWN", detail: `Source responded ${res.status}.`, failed: true };
          const pkg = (await res.json()) as Package;
          const t = pkg.releases?.[0]?.tender;
          if (!t) return { status: "UNKNOWN", detail: "Notice returned without tender data." };
          if (t.status && t.status !== "active") return { status: "CLOSED", detail: `Tender status at source: ${t.status}.` };
          return { status: "ACTIVE", detail: "Notice is published with tender status active.", deadline: parseDeadline(t.tenderPeriod?.endDate).deadline };
        } catch (e) {
          return { status: "UNKNOWN", detail: e instanceof ProviderHttpError ? e.message : "Status check failed", failed: true };
        }
      },
    }),
  };
}

const isoNoMs = (d: Date) => d.toISOString().slice(0, 19);

export const findATenderProvider = makeOcdsProvider({
  id: "find-a-tender",
  name: "Find a Tender (UK)",
  publisher: "Find a Tender service — UK Cabinet Office",
  docsUrl: "https://www.find-tender.service.gov.uk/Developer/Documentation",
  homepage: "https://www.find-tender.service.gov.uk",
  level: "NATIONAL_OFFICIAL",
  note: "UK public procurement notices published on Find a Tender (the UK's notice service for higher-value procurements).",
  description: "UK tender notices with buyer, CPV classification, tender deadline, contact point and submission route.",
  limitations: "Cancellations are published as later releases of the same procurement; the status check reads the notice, not the whole procurement history.",
  firstUrl: (since) => `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?stages=tender&limit=100&updatedFrom=${encodeURIComponent(isoNoMs(since))}`,
  noticeUrl: (r) => `https://www.find-tender.service.gov.uk/Notice/${encodeURIComponent(r.id)}`,
  checkUrl: (id) => `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages/${encodeURIComponent(id)}`,
});

export const contractsFinderProvider = makeOcdsProvider({
  id: "contracts-finder",
  name: "Contracts Finder (UK)",
  publisher: "Contracts Finder — UK Cabinet Office",
  docsUrl: "https://www.contractsfinder.service.gov.uk/apidocumentation",
  homepage: "https://www.contractsfinder.service.gov.uk",
  level: "PARTIAL",
  note: "Lower-value opportunities, mainly English public bodies; some private buyers also publish here.",
  description: "Lower-value UK opportunities with buyer, CPV classification, deadline and published contact point.",
  limitations: "Many notices duplicate Find a Tender notices; they are folded together by strict buyer + title + deadline matching. No per-notice status check.",
  firstUrl: (since) => `https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search?stages=tender&limit=100&publishedFrom=${encodeURIComponent(isoNoMs(since))}`,
  noticeUrl: (r) => {
    const m = /^([0-9a-f-]{36})/i.exec(r.id);
    return m ? `https://www.contractsfinder.service.gov.uk/Notice/${m[1]}` : undefined;
  },
});
