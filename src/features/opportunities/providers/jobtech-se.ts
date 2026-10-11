import "server-only";
import { createHttpClient, ProviderHttpError } from "@/features/registry/http";
import { cleanUrl, normalizeRegNumber, parseDeadline, parseSourceDate, truncate, uniq } from "../normalize";
import type { ActivityCheckResult, FetchContext, FetchResult, NormalizedContact, NormalizedOpportunity, OpportunityProvider } from "./types";

/**
 * Sweden — Arbetsförmedlingen (Swedish Public Employment Service) via JobTech Dev:
 *   JobSearch  https://jobsearch.api.jobtechdev.se  (search, single ad)
 *   JobStream  https://jobstream.api.jobtechdev.se  (all changes since a time, incl. removals)
 * Open, no API key. Ads carry the employer's organisation number, so employer identity
 * can be matched against the company register.
 *
 * Strategy: the first run backfills recent ads in the configured occupation fields via
 * JobSearch; later runs read JobStream since the cursor (unfiltered — removal events carry
 * no occupation, so filtering happens locally) and apply explicit removals.
 */
const http = createHttpClient({ name: "JobTech (Arbetsförmedlingen)", minIntervalMs: 400, timeoutMs: 60_000 });
const SEARCH = "https://jobsearch.api.jobtechdev.se";
const STREAM = "https://jobstream.api.jobtechdev.se";
/** Occupation field "Data/IT" in the JobTech taxonomy (verified against JobSearch). */
const DEFAULT_FIELDS = ["apaJ_2ja_LuF"];

type Concept = { concept_id?: string | null; label?: string | null };
type Ad = {
  id: string;
  headline?: string;
  webpage_url?: string;
  application_deadline?: string | null;
  description?: { text?: string | null };
  employment_type?: Concept;
  employer?: { phone_number?: string | null; email?: string | null; url?: string | null; organization_number?: string | null; name?: string | null; workplace?: string | null };
  application_details?: { email?: string | null; url?: string | null; via_af?: boolean | null };
  application_contacts?: { name?: string | null; description?: string | null; email?: string | null; telephone?: string | null; contact_type?: string | null }[];
  occupation?: Concept;
  occupation_field?: Concept;
  workplace_address?: { municipality?: string | null; region?: string | null; country?: string | null; country_code?: string | null };
  publication_date?: string | null;
  last_publication_date?: string | null;
  removed?: boolean;
  removed_date?: string | null;
  source_type?: string | null;
};

function fields(settings: Record<string, unknown>): string[] | "ALL" {
  const raw = settings.occupationFields;
  if (raw === "ALL" || (Array.isArray(raw) && raw.includes("ALL"))) return "ALL";
  const list = Array.isArray(raw) ? raw.map(String).filter(Boolean) : typeof raw === "string" ? raw.split(/[,\s]+/).filter(Boolean) : [];
  return list.length ? list : DEFAULT_FIELDS;
}

function inScope(ad: Ad, f: string[] | "ALL") {
  return f === "ALL" || (!!ad.occupation_field?.concept_id && f.includes(ad.occupation_field.concept_id));
}

function normalize(ad: Ad): NormalizedOpportunity {
  const contacts: NormalizedContact[] = [];
  for (const c of ad.application_contacts ?? []) {
    if (c.name || c.email || c.telephone) contacts.push({ kind: "NAMED_PERSON", name: c.name ?? undefined, role: c.description ?? c.contact_type ?? undefined, email: c.email ?? undefined, phone: c.telephone ?? undefined });
  }
  if (ad.application_details?.email) contacts.push({ kind: "APPLICATION_EMAIL", email: ad.application_details.email });
  if (ad.employer?.email) contacts.push({ kind: "ORGANIZATION_EMAIL", email: ad.employer.email });
  if (ad.employer?.phone_number) contacts.push({ kind: "ORGANIZATION_PHONE", phone: ad.employer.phone_number });
  if (ad.employer?.url) contacts.push({ kind: "ORGANIZATION_WEBSITE", url: cleanUrl(ad.employer.url) });
  const applyExternal = cleanUrl(ad.application_details?.url);
  if (applyExternal) contacts.push({ kind: "APPLICATION_LINK", url: applyExternal });
  const { deadline, deadlineText } = parseDeadline(ad.application_deadline ?? undefined);
  const addr = ad.workplace_address;
  return {
    externalId: ad.id,
    type: "HIRING",
    title: ad.headline ?? "(untitled ad)",
    organization: { name: ad.employer?.name ?? undefined, registrationNumber: normalizeRegNumber(ad.employer?.organization_number), registrationCountry: "SE", website: cleanUrl(ad.employer?.url) },
    // Ads on Platsbanken are Swedish job ads; a foreign workplace country is respected when given.
    countryCode: addr?.country_code && addr.country_code !== "199" && addr.country && !/sverige|sweden/i.test(addr.country) ? undefined : "SE",
    location: uniq([addr?.municipality, addr?.region]).join(", ") || undefined,
    summary: truncate(ad.description?.text ?? undefined, 4000),
    sourceUrl: cleanUrl(ad.webpage_url),
    applyUrl: applyExternal,
    sourceClass: "OFFICIAL_PUBLIC_EMPLOYMENT_SERVICE",
    sourcePublisher: "Arbetsförmedlingen (Platsbanken)",
    publishedAt: parseSourceDate(ad.publication_date ?? undefined),
    deadline,
    deadlineText,
    sourceSaysActive: !ad.removed,
    jobCategory: ad.occupation?.label ?? undefined,
    employmentType: ad.employment_type?.label ?? undefined,
    classification: { scheme: "JobTech taxonomy", codes: uniq([ad.occupation_field?.concept_id, ad.occupation?.concept_id]), labels: uniq([ad.occupation_field?.label, ad.occupation?.label]) },
    contacts,
  };
}

export const jobtechProvider: OpportunityProvider = {
  id: "jobtech-se",
  name: "Arbetsförmedlingen — JobTech JobSearch & JobStream",
  publisher: "Arbetsförmedlingen (Swedish Public Employment Service)",
  type: "HIRING",
  defaultSourceClass: "OFFICIAL_PUBLIC_EMPLOYMENT_SERVICE",
  perEmployer: false,
  coverage: [{ code: "SE", level: "NATIONAL_OFFICIAL", note: "All ads on Platsbanken, the national public job board. Ads published only on private boards are not included." }],
  access: { type: "OPEN", requiredEnv: [], signupUrl: "https://jobtechdev.se/en/components/jobstream", termsUrl: "https://jobtechdev.se", termsNote: "Open APIs from JobTech Development (Arbetsförmedlingen); no key required. Review JobTech's terms before redistribution." },
  docsUrl: "https://jobtechdev.se/en/components/jobstream",
  homepage: "https://arbetsformedlingen.se/platsbanken",
  description: "Swedish job ads with employer name and organisation number, occupation taxonomy, application deadline, and explicit removal events.",
  limitations: "The poster can be the employer or a staffing agency acting for it — identity is confirmed only when the organisation number matches a registry record. Default scope: occupation field Data/IT (configurable).",
  capabilities: { incremental: true, pagination: true, publishedAt: true, updatedAt: false, deadline: true, removalDetection: "EXPLICIT", activityCheck: true, employerIdentity: "REGISTRATION_NUMBER", contacts: true, webhooks: false, directApplyLink: false },
  evidence: "REAL_DATA_TESTED",
  freshnessNote: "JobStream delivers changes as Arbetsförmedlingen publishes them; ExploreTechify polls it periodically (not real-time).",
  recommendedIntervalMinutes: 30,
  settingFields: [
    { key: "occupationFields", label: "Occupation field concept ids", kind: "list", defaultValue: DEFAULT_FIELDS.join(", "), help: "JobTech taxonomy occupation-field ids (apaJ_2ja_LuF = Data/IT). Use ALL for every occupation (large volume)." },
    { key: "initialDays", label: "Initial backfill (days)", kind: "number", defaultValue: 7, help: "How far back the first run reads." },
  ],
  isConfigured: () => ({ ok: true, missing: [] }),
  async fetch(ctx: FetchContext): Promise<FetchResult> {
    const f = fields(ctx.feed.settings);
    const startedAt = new Date();
    if (!ctx.cursor) {
      // Initial backfill via JobSearch (bounded by offset limits of the API).
      const days = Math.min(Math.max(Number(ctx.feed.settings.initialDays ?? 7), 1), 30);
      const after = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 19);
      const items: NormalizedOpportunity[] = [];
      const page = 100;
      let complete = true;
      const fieldSets: (string | null)[] = f === "ALL" ? [null] : f;
      for (const field of fieldSets) {
        for (let offset = 0; ; offset += page) {
          if (items.length >= ctx.limit || offset >= 2000) {
            complete = false;
            break;
          }
          const q = new URLSearchParams({ "published-after": after, limit: String(page), offset: String(offset), sort: "pubdate-desc" });
          if (field) q.set("occupation-field", field);
          const res = await http.json<{ hits: Ad[] }>(`${SEARCH}/search?${q}`, { signal: ctx.signal });
          items.push(...res.hits.map(normalize));
          if (res.hits.length < page) break;
        }
      }
      return { items: items.filter((i) => i.countryCode), outOfScope: items.filter((i) => !i.countryCode).length, complete, cursor: startedAt.toISOString() };
    }
    // Incremental: JobStream since the cursor (overlap of 2 minutes; ingestion is idempotent).
    const since = new Date(new Date(ctx.cursor).getTime() - 120_000).toISOString().slice(0, 19);
    const ads = await http.json<Ad[]>(`${STREAM}/stream?date=${encodeURIComponent(since)}`, { signal: ctx.signal });
    const removedIds = ads.filter((a) => a.removed).map((a) => a.id);
    const live = ads.filter((a) => !a.removed);
    const scoped = live.filter((a) => inScope(a, f));
    // The whole change set since the cursor is already downloaded, so all of it is processed.
    const items = scoped.map(normalize);
    return { items: items.filter((i) => i.countryCode), removedIds, outOfScope: live.length - scoped.length + items.filter((i) => !i.countryCode).length, complete: true, cursor: startedAt.toISOString() };
  },
  async checkActivity(item): Promise<ActivityCheckResult> {
    try {
      const res = await http.request(`${SEARCH}/ad/${encodeURIComponent(item.externalId)}`);
      if (res.status === 404) {
        await res.body?.cancel().catch(() => undefined);
        return { status: "REMOVED", detail: "JobSearch reports the ad is not found (404)." };
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return { status: "UNKNOWN", detail: `JobSearch responded ${res.status}.`, failed: true };
      }
      const ad = (await res.json()) as Ad;
      if (ad.removed) return { status: "REMOVED", detail: `Ad marked removed${ad.removed_date ? ` on ${ad.removed_date}` : ""}.` };
      return { status: "ACTIVE", detail: "Ad is published on Platsbanken.", deadline: parseDeadline(ad.application_deadline ?? undefined).deadline };
    } catch (e) {
      return { status: "UNKNOWN", detail: e instanceof ProviderHttpError ? e.message : "Status check failed", failed: true };
    }
  },
};
