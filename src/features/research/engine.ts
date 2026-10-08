import "server-only";
import type { Types } from "mongoose";
import { Company, Contact, type CompanyDoc, type ContactDoc } from "@/models";
import { getSetting } from "@/features/settings/service";
import type { ResearchSettings } from "@/features/settings/schemas";
import { getRegistryProvider } from "@/features/registry/providers";
import { buildCompanyUpdate, type ExistingCompany } from "@/features/registry/normalize";
import { cleanWebsite } from "@/features/registry/normalize-helpers";
import { hasMxRecord } from "@/features/intelligence/safe-fetch";
import { enqueueJob, registerJobHandler } from "@/features/jobs/queue";
import { type ResearchStatus } from "@/lib/company-fields";
import { addDays, todayIn } from "@/lib/dates/country-time";
import { getCountry } from "@/config/countries";
import { canSpend, getCached, recordUsage, setCached, type PaidProviderId } from "./budget";
import { flagSharedContacts, recomputeCompanyContacts, recordContact, type ContactInput } from "./contacts";
import { addInboxItem, publishIntelUpdate } from "./inbox";
import { domainCandidates, identityEvidence, researchWebsite } from "./website";
import { fetchPublicPage } from "@/features/intelligence/safe-fetch";
import { hunterDomainFinder, hunterDomainSearch, hunterKey, hunterVerifyEmail, mapHunterStatus } from "./providers/hunter";
import { apolloEnrichOrganization, apolloKey } from "./providers/apollo";
import { braveKey, braveWebSearch } from "./providers/brave";

/**
 * Automatic contact research for one company — a bounded, configurable sequence:
 *   1. official registry re-check (free)
 *   2. official website: known website, else verified discovery (free; web search if enabled)
 *   3. approved paid providers within budget: Hunter Domain Search, Apollo organization phone
 *   4. verification: free MX check, then Hunter Email Verifier if enabled
 * Every value keeps its source. Ambiguous matches go to the review queue.
 * Research failures never affect registry ingestion.
 */

export type ResearchStep = { step: string; status: "done" | "nothing" | "skipped" | "failed" | "paused"; detail: string };

const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
};

function cohortPriority(registrationDay?: string | null) {
  if (!registrationDay) return 0;
  const ageDays = (Date.now() - Date.parse(`${registrationDay}T00:00:00Z`)) / 86_400_000;
  return Math.max(0, Math.round(100 - ageDays)); // newest registrations first
}

/** Queue research for a company without delaying its appearance in the table. */
export async function enqueueResearch(companyId: Types.ObjectId | string, opts: { reason?: string; runAt?: Date; registrationDay?: string | null } = {}) {
  await enqueueJob("research", `research:${companyId}`, { companyId: String(companyId), reason: opts.reason ?? "new" }, { runAt: opts.runAt, priority: cohortPriority(opts.registrationDay) });
  await Company.updateOne({ _id: companyId, "research.status": { $in: ["NOT_STARTED", null] } }, { $set: { "research.status": "SEARCHING" } });
}

type Ctx = {
  company: CompanyDoc;
  settings: ResearchSettings;
  steps: ResearchStep[];
  costCents: number;
  budgetBlocked: boolean;
  providerErrors: number;
  reviewAdded: number;
};

async function paidCall<T>(ctx: Ctx, provider: PaidProviderId, operation: string, hasKey: boolean, cacheKey: string, fn: () => Promise<T>): Promise<{ result?: T; skipped?: string; cached?: boolean }> {
  const cached = await getCached<T>(cacheKey);
  if (cached !== undefined) {
    await recordUsage({ provider, operation, companyId: ctx.company._id, countryCode: ctx.company.countryCode, costCents: 0, outcome: "CACHED" });
    return { result: cached, cached: true };
  }
  const decision = await canSpend(provider, hasKey, { ...ctx.company, research: { costCents: (ctx.company.research?.costCents ?? 0) + ctx.costCents } }, ctx.settings);
  if (!decision.ok) {
    if (decision.reason === "BUDGET_DAILY" || decision.reason === "BUDGET_MONTHLY" || decision.reason === "COMPANY_LIMIT") ctx.budgetBlocked = true;
    return { skipped: decision.reason };
  }
  try {
    const result = await fn();
    ctx.costCents += decision.costCents;
    const found = Array.isArray(result) ? result.length > 0 : !!result;
    await recordUsage({ provider, operation, companyId: ctx.company._id, countryCode: ctx.company.countryCode, costCents: decision.costCents, outcome: found ? "FOUND" : "NOT_FOUND" });
    await setCached(cacheKey, provider, result ?? null, found ? 90 : ctx.settings.negativeCacheDays);
    return { result };
  } catch (err) {
    ctx.providerErrors++;
    const quota = (err as { status?: number }).status === 429;
    await recordUsage({ provider, operation, companyId: ctx.company._id, countryCode: ctx.company.countryCode, costCents: 0, outcome: quota ? "QUOTA" : "ERROR", detail: err instanceof Error ? err.message : String(err) });
    return { skipped: quota ? "QUOTA" : `ERROR: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function stepRegistry(ctx: Ctx) {
  const c = ctx.company;
  const provider = getRegistryProvider(c.source);
  if (!provider || provider.isDemo || !provider.getCompany || !c.registrationNumber || !provider.isConfigured()) {
    ctx.steps.push({ step: "registry", status: "skipped", detail: "This source has no single-company lookup (or no credentials)." });
    return;
  }
  try {
    const fresh = await provider.getCompany(c.registrationNumber, { signal: AbortSignal.timeout(20_000) });
    if (!fresh) {
      ctx.steps.push({ step: "registry", status: "nothing", detail: `${provider.sourceName} no longer lists this company.` });
      return;
    }
    const { set, unset } = buildCompanyUpdate(fresh, provider, c.countryCode, c as unknown as ExistingCompany, new Date());
    await Company.updateOne({ _id: c._id }, { $set: set, ...(Object.keys(unset).length && { $unset: unset }) });
    const values: ContactInput[] = [];
    if (fresh.contact.email) values.push({ type: "EMAIL", value: fresh.contact.email, sourceKind: "REGISTRY", source: provider.sourceName, sourceUrl: fresh.source.url });
    if (fresh.contact.phone) values.push({ type: "PHONE", value: fresh.contact.phone, sourceKind: "REGISTRY", source: provider.sourceName, sourceUrl: fresh.source.url });
    if (fresh.contact.mobile) values.push({ type: "MOBILE", value: fresh.contact.mobile, sourceKind: "REGISTRY", source: provider.sourceName, sourceUrl: fresh.source.url });
    if (fresh.contact.website) values.push({ type: "WEBSITE", value: fresh.contact.website, sourceKind: "REGISTRY", source: provider.sourceName, sourceUrl: fresh.source.url });
    for (const v of values) await recordContact(c, v);
    ctx.company = (await Company.findById(c._id).lean<CompanyDoc>())!;
    ctx.steps.push({ step: "registry", status: values.length ? "done" : "nothing", detail: values.length ? `${provider.sourceName} lists: ${values.map((v) => v.value).join(", ")}` : `${provider.sourceName} has no contact details for this company yet.` });
  } catch (err) {
    ctx.providerErrors++;
    ctx.steps.push({ step: "registry", status: "failed", detail: err instanceof Error ? err.message : "Registry lookup failed" });
  }
}

/** Record everything found on a verified website. */
async function recordWebsiteFindings(ctx: Ctx, site: Awaited<ReturnType<typeof researchWebsite>>, siteOwnership: "CONFIRMED" | "LIKELY" | "GROUP_LEVEL", siteSource: string) {
  const c = ctx.company;
  let n = 0;
  for (const e of site.emails) {
    const foreign = !e.onOwnDomain && !e.webmail;
    await recordContact(c, {
      type: "EMAIL",
      value: e.value,
      sourceKind: "WEBSITE",
      source: siteSource,
      sourceUrl: e.url,
      provider: "website",
      ownership: foreign ? "UNCERTAIN" : siteOwnership,
      needsReview: foreign,
      evidence: [{ kind: "PUBLISHED_ON_SITE", detail: foreign ? "Published on the company's site but on another domain — could belong to a web agency or partner." : `Published on ${new URL(e.url).hostname}${e.webmail ? " (webmail address published by the company)" : ""}`, url: e.url }],
    });
    n++;
  }
  for (const p of site.phones) {
    await recordContact(c, { type: "PHONE", value: p.value, sourceKind: "WEBSITE", source: siteSource, sourceUrl: p.url, provider: "website", ownership: siteOwnership, evidence: [{ kind: "PUBLISHED_ON_SITE", detail: `Published on ${new URL(p.url).hostname} (${p.via})`, url: p.url }] });
    n++;
  }
  for (const f of site.forms.slice(0, 1)) {
    await recordContact(c, { type: "CONTACT_FORM", value: f, sourceKind: "WEBSITE", source: siteSource, sourceUrl: f, provider: "website", ownership: siteOwnership, evidence: [{ kind: "CONTACT_FORM", detail: "Business contact form (contact form only — never submitted automatically)", url: f }] });
  }
  return n;
}

async function stepWebsite(ctx: Ctx) {
  const c = ctx.company;
  let website = c.website ?? undefined;
  let websiteFromRegistry = c.contactSources?.website?.kind === "REGISTRY" || c.contactSources?.website?.kind === "MANUAL";

  // Discovery when no website is known: plausible own domains, verified by identity on the page.
  if (!website && ctx.settings.websiteDiscovery) {
    for (const domain of domainCandidates(c.companyName, c.countryCode)) {
      const page = await fetchPublicPage(`https://${domain}`);
      if ("error" in page) continue;
      const identity = identityEvidence(page.html, c);
      if (identity) {
        website = cleanWebsite(new URL(page.url).origin);
        await recordContact(c, { type: "WEBSITE", value: website!, sourceKind: "WEBSITE", source: "Website discovery", sourceUrl: page.url, provider: "website", ownership: identity === "REGISTRATION_NUMBER" ? "CONFIRMED" : "LIKELY", needsReview: identity !== "REGISTRATION_NUMBER", evidence: [{ kind: "IDENTITY", detail: identity === "REGISTRATION_NUMBER" ? "Site shows the registration number" : "Site shows the exact legal name (no registration number)", url: page.url }] });
        websiteFromRegistry = identity === "REGISTRATION_NUMBER";
        break;
      }
    }
  }

  // Web search (Brave) when still unknown: candidate pages must show the registration number.
  if (!website && ctx.settings.websiteDiscovery) {
    const query = `"${c.companyName}"${c.registrationNumber ? ` ${c.registrationNumber}` : ""}${c.city ? ` ${c.city}` : ""}`;
    const r = await paidCall(ctx, "brave", "web-search", !!braveKey(), `brave:${c.countryCode}:${query}`, () => braveWebSearch(query, { country: c.countryCode, count: 10 }));
    if (r.result?.length) {
      let accepted = 0;
      for (const hit of r.result.slice(0, 5)) {
        const page = await fetchPublicPage(hit.url);
        if ("error" in page) continue;
        if (identityEvidence(page.html, c) !== "REGISTRATION_NUMBER") continue;
        const host = domainOf(page.url) ?? "";
        const tokens = c.companyName.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
        const looksOwn = tokens.some((t) => host.includes(t));
        if (looksOwn) {
          website = cleanWebsite(new URL(page.url).origin);
          await recordContact(c, { type: "WEBSITE", value: website!, sourceKind: "WEBSITE", source: "Web search (verified by registration number)", sourceUrl: page.url, provider: "brave", ownership: "CONFIRMED", evidence: [{ kind: "IDENTITY", detail: "Search result site shows the registration number", url: page.url }] });
          websiteFromRegistry = true;
          break;
        }
        // A third-party page that shows the registration number: public business source, needs review.
        const { extractFromPage } = await import("./website");
        const found = extractFromPage(page.html, page.url, c.countryCode);
        for (const p of found.phones.slice(0, 2)) {
          await recordContact(c, { type: "PHONE", value: p.value, sourceKind: "PUBLIC", source: `Public page (${host})`, sourceUrl: page.url, provider: "brave", ownership: "LIKELY", needsReview: true, evidence: [{ kind: "PUBLIC_PAGE", detail: `Listed on ${host} next to the registration number — confirm it is company-operated before use.`, url: page.url }] });
          accepted++;
          ctx.reviewAdded++;
        }
      }
      ctx.steps.push({ step: "web-search", status: website || accepted ? "done" : "nothing", detail: website ? `Found ${website}` : accepted ? `${accepted} value(s) on public pages sent to review` : "No search result could be verified by registration number." });
    } else {
      ctx.steps.push({ step: "web-search", status: r.skipped ? "skipped" : "nothing", detail: r.skipped ? `Web search not run (${r.skipped.toLowerCase()})` : "No results." });
    }
  }

  if (!website) {
    ctx.steps.push({ step: "website", status: "nothing", detail: "No verified website found yet (this is not proof the company has none)." });
    return undefined;
  }

  const site = await researchWebsite(website, { companyName: c.companyName, registrationNumber: c.registrationNumber, countryCode: c.countryCode }, ctx.settings.maxPagesPerWebsite);
  if (!site.reachable) {
    ctx.steps.push({ step: "website", status: "failed", detail: `Could not read ${website}: ${site.error}` });
    return website;
  }
  const host = domainOf(site.website);
  const sharedWith = host ? await Company.countDocuments({ _id: { $ne: c._id }, website: new RegExp(`^https?://(www\\.)?${host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i") }) : 0;
  let ownership: "CONFIRMED" | "LIKELY" | "GROUP_LEVEL" = site.identity === "REGISTRATION_NUMBER" || websiteFromRegistry ? "CONFIRMED" : "LIKELY";
  if (sharedWith > 0 && site.identity !== "REGISTRATION_NUMBER") ownership = "GROUP_LEVEL";
  const n = await recordWebsiteFindings(ctx, site, ownership, ownership === "GROUP_LEVEL" ? `Shared website (group-level route, ${host})` : `Company website (${host})`);
  ctx.steps.push({
    step: "website",
    status: n || site.forms.length ? "done" : "nothing",
    detail: `${site.pagesChecked.length} page(s) checked on ${host}: ${site.emails.length} email(s), ${site.phones.length} phone(s)${site.forms.length ? ", contact form" : ""}${ownership === "GROUP_LEVEL" ? " — website shared with another company, recorded as group-level route" : ""}.`,
  });
  return website;
}

async function stepPaidProviders(ctx: Ctx, website: string | undefined) {
  const c = ctx.company;
  const domain = website ? domainOf(website) : undefined;
  const current = await Contact.find({ companyId: c._id }).lean<ContactDoc[]>();
  const hasEmail = current.some((x) => x.type === "EMAIL" && x.usable && x.ownership !== "INTERMEDIARY");
  const hasPhone = current.some((x) => (x.type === "PHONE" || x.type === "MOBILE") && x.usable && x.ownership !== "INTERMEDIARY");
  const order = (["hunter", "apollo"] as const).slice().sort((a, b) => ctx.settings.providers[a].priority - ctx.settings.providers[b].priority);

  for (const p of order) {
    if (p === "hunter") {
      if (domain && !hasEmail) {
        const r = await paidCall(ctx, "hunter", "domain-search", !!hunterKey(), `hunter:ds:${domain}`, () => hunterDomainSearch(domain));
        if (r.result) {
          let n = 0;
          for (const e of r.result.emails ?? []) {
            const personal = e.type === "personal";
            await recordContact(c, {
              type: "EMAIL",
              value: e.value.toLowerCase(),
              sourceKind: "ENRICHMENT",
              source: "Hunter Domain Search",
              sourceUrl: e.sources?.[0]?.uri,
              provider: "hunter",
              ownership: "LIKELY",
              needsReview: personal,
              personName: personal ? [e.first_name, e.last_name].filter(Boolean).join(" ") || undefined : undefined,
              role: personal ? (e.position ?? undefined) : undefined,
              providerConfidence: e.confidence,
              emailVerification: e.verification?.status === "valid" ? "DELIVERABLE" : e.verification?.status === "accept_all" ? "CATCH_ALL" : e.verification?.status === "invalid" ? "INVALID" : "UNKNOWN",
              evidence: [{ kind: "PROVIDER", detail: `Hunter: ${e.type ?? "email"} on ${domain}, ${e.sources?.length ?? 0} source page(s)${e.sources?.[0]?.last_seen_on ? `, last seen ${e.sources[0].last_seen_on}` : ""}`, url: e.sources?.[0]?.uri }],
            });
            n++;
          }
          ctx.steps.push({ step: "hunter", status: n ? "done" : "nothing", detail: n ? `${n} sourced email(s) for ${domain}${r.cached ? " (cached)" : ""}` : `No emails for ${domain}` });
        } else ctx.steps.push({ step: "hunter", status: r.skipped?.startsWith("BUDGET") || r.skipped === "COMPANY_LIMIT" ? "paused" : "skipped", detail: `Hunter not run (${(r.skipped ?? "").toLowerCase()})` });
      } else if (!domain && !hasEmail) {
        const r = await paidCall(ctx, "hunter", "domain-finder", !!hunterKey(), `hunter:df:${c.countryCode}:${c.companyName}`, () => hunterDomainFinder(c.companyName));
        const list = Array.isArray(r.result) ? r.result : r.result ? [r.result] : [];
        for (const d of list.slice(0, 3)) {
          await recordContact(c, { type: "WEBSITE", value: `https://${d.domain}`, sourceKind: "ENRICHMENT", source: "Hunter Domain Finder (beta)", provider: "hunter", ownership: "UNCERTAIN", needsReview: true, evidence: [{ kind: "CANDIDATE", detail: `Candidate domain for "${c.companyName}"${d.company_name ? ` (Hunter: ${d.company_name})` : ""} — not verified` }] });
          ctx.reviewAdded++;
        }
        if (list.length || r.skipped) ctx.steps.push({ step: "hunter-domain", status: list.length ? "done" : "skipped", detail: list.length ? `${list.length} candidate domain(s) sent to review` : `Domain finder not run (${(r.skipped ?? "").toLowerCase()})` });
      }
    }
    if (p === "apollo" && domain && !hasPhone) {
      const r = await paidCall(ctx, "apollo", "organization-enrich", !!apolloKey(), `apollo:org:${domain}`, () => apolloEnrichOrganization(domain, c.companyName));
      const org = r.result;
      const phone = org?.primary_phone?.sanitized_number ?? org?.sanitized_phone ?? org?.primary_phone?.number ?? org?.phone;
      if (org && phone) {
        const nameMatch = !!org.name && c.companyName.toLowerCase().includes(org.name.toLowerCase().split(/\s+/)[0] ?? "");
        await recordContact(c, { type: "PHONE", value: phone.startsWith("+") ? phone.replace(/[^\d+]/g, "") : phone, sourceKind: "ENRICHMENT", source: "Apollo organization enrichment", provider: "apollo", ownership: "LIKELY", needsReview: !nameMatch, evidence: [{ kind: "PROVIDER", detail: `Apollo match on domain ${domain} (organization: ${org.name ?? "unnamed"}${org.primary_phone?.source ? `, phone source: ${org.primary_phone.source}` : ""})` }] });
        ctx.steps.push({ step: "apollo", status: "done", detail: `Corporate phone from Apollo${nameMatch ? "" : " — organization name differs, sent to review"}` });
      } else ctx.steps.push({ step: "apollo", status: r.skipped ? (r.skipped.startsWith("BUDGET") ? "paused" : "skipped") : "nothing", detail: r.skipped ? `Apollo not run (${r.skipped.toLowerCase()})` : `Apollo returned no phone for ${domain} (phone research continues)` });
    }
  }
}

async function stepVerify(ctx: Ctx) {
  const emails = await Contact.find({ companyId: ctx.company._id, type: "EMAIL", usable: true, emailVerification: { $in: ["SOURCE_CONFIRMED", "UNKNOWN", null] } }).lean<ContactDoc[]>();
  let checked = 0;
  for (const e of emails.slice(0, 5)) {
    const domain = e.value.split("@")[1]!;
    const mx = await hasMxRecord(domain);
    if (mx === false) {
      await Contact.updateOne({ _id: e._id }, { $push: { evidence: { kind: "MX", detail: "No MX record for the domain (mail may still work via A record — not marked invalid)", at: new Date() } } });
    }
    if (mx !== null) checked++;
    if (ctx.settings.verifyEmailsWithHunter) {
      const r = await paidCall(ctx, "hunter", "email-verifier", !!hunterKey(), `hunter:ev:${e.value}`, () => hunterVerifyEmail(e.value));
      if (r.result) {
        const status = mapHunterStatus(r.result.status);
        await Contact.updateOne({ _id: e._id }, { $set: { emailVerification: status, verified: status === "DELIVERABLE", verifiedAt: new Date(), verificationMethod: `Hunter Email Verifier: ${r.result.status}` } });
        if (status === "INVALID" || status === "DELIVERABLE") {
          await addInboxItem({ type: "VERIFICATION_CHANGE", dedupeKey: `verify:${e._id}:${status}`, companyId: ctx.company._id, countryCode: ctx.company.countryCode, title: `${e.value}: ${status === "INVALID" ? "invalid" : "deliverability verified"}`, body: ctx.company.companyName });
        }
      }
    }
  }
  if (emails.length) ctx.steps.push({ step: "verification", status: checked ? "done" : "failed", detail: checked ? `${checked} email domain(s) checked (MX)${ctx.settings.verifyEmailsWithHunter ? "; Hunter verifier where budget allowed" : ""}` : "DNS not reachable — emails stay unverified" });
}

function nextRetry(settings: ResearchSettings, attempts: number) {
  const days = settings.retryDays[attempts - 1];
  return days === undefined ? null : new Date(Date.now() + days * 86_400_000);
}

/** Run one research attempt for a company. */
export async function researchCompany(companyId: Types.ObjectId | string, opts: { reason?: string; manual?: boolean } = {}) {
  const settings = await getSetting("research");
  const company = await Company.findById(companyId).lean<CompanyDoc>();
  if (!company) return null;
  if (company.isDemo) return { steps: [{ step: "research", status: "skipped" as const, detail: "Demo companies are not researched." }], status: "EXHAUSTED" as ResearchStatus };
  if (!settings.enabled && !opts.manual) return null;

  await Company.updateOne({ _id: company._id }, { $set: { "research.status": "SEARCHING" } });
  const ctx: Ctx = { company, settings, steps: [], costCents: 0, budgetBlocked: false, providerErrors: 0, reviewAdded: 0 };

  await stepRegistry(ctx);
  const website = await stepWebsite(ctx);
  await stepPaidProviders(ctx, website);
  await stepVerify(ctx);
  const values = (await Contact.find({ companyId: company._id, type: { $in: ["EMAIL", "PHONE", "MOBILE"] } }).select("value").lean<{ value: string }[]>()).map((v) => v.value);
  await flagSharedContacts(values, settings.sharedContactThreshold);
  const { becameContactable } = await recomputeCompanyContacts(company._id);

  const fresh = (await Company.findById(company._id).lean<CompanyDoc>())!;
  const attempts = (company.research?.attempts ?? 0) + 1;
  const dc = fresh.directContact;
  let status: ResearchStatus;
  let next: Date | null = null;
  if (dc?.has) {
    if (dc.pendingVerification) status = "VERIFICATION_PENDING";
    else status = dc.hasEmail && dc.hasPhone ? "CONTACTS_FOUND" : "PARTIAL";
    if (!(dc.hasEmail && dc.hasPhone)) next = nextRetry(settings, attempts); // keep looking for the missing channel
  } else if (ctx.budgetBlocked) {
    status = "BUDGET_PAUSED";
    next = nextRetry(settings, attempts) ?? new Date(Date.now() + 86_400_000);
  } else if (ctx.providerErrors > 0 && ctx.steps.every((s) => s.status !== "done")) {
    status = "PROVIDER_UNAVAILABLE";
    next = new Date(Date.now() + 3 * 3_600_000);
  } else {
    next = nextRetry(settings, attempts);
    status = next ? "RETRY_SCHEDULED" : "EXHAUSTED";
  }
  if (!dc?.has && status === "RETRY_SCHEDULED" && attempts === 1) status = "NO_CONTACT_YET";

  const checked = ctx.steps.map((s) => ({ source: s.step, at: new Date(), outcome: `${s.status}: ${s.detail}`.slice(0, 300) }));
  await Company.updateOne(
    { _id: company._id },
    {
      $set: {
        "research.status": status,
        "research.attempts": attempts,
        "research.lastAttemptAt": new Date(),
        "research.nextRetryAt": next,
        "research.lastFailure": ctx.steps.find((s) => s.status === "failed")?.detail,
        "research.reasonForNext": next ? "Scheduled retry" : undefined,
      },
      $inc: { "research.costCents": ctx.costCents },
      $push: { "research.checkedSources": { $each: checked, $slice: -30 } },
    },
  );
  if (next) await enqueueJob("research", `research:${company._id}`, { companyId: String(company._id), reason: "retry" }, { runAt: next, priority: cohortPriority(company.registrationDay) });

  if (becameContactable) {
    const { refreshSnapshotDays } = await import("@/features/registry/sync");
    await refreshSnapshotDays(company.countryCode, [company.registrationDay], !!company.isDemo);
    await addInboxItem({ type: "NEW_CONTACTABLE", dedupeKey: `contactable:${company._id}`, companyId: company._id, countryCode: company.countryCode, title: `${company.companyName} is now contactable`, body: [fresh.email, fresh.phone ?? fresh.mobile].filter(Boolean).join(" · "), priority: fresh.serviceFit?.score ?? 0 });
    publishIntelUpdate({ countryCode: company.countryCode, kind: "contacts", count: 1, companyIds: [String(company._id)] });
  }
  if (ctx.reviewAdded) await addInboxItem({ type: "REVIEW_NEEDED", dedupeKey: `review:${company._id}:${attempts}`, companyId: company._id, countryCode: company.countryCode, title: `${company.companyName}: ${ctx.reviewAdded} contact value(s) need review`, body: "Ambiguous matches never count as direct contacts until approved." });

  // Service fit is re-assessed whenever evidence changes.
  const { assessServiceFit } = await import("@/features/service-fit/service");
  await assessServiceFit(company._id).catch(() => undefined);
  return { steps: ctx.steps, status, costCents: ctx.costCents, nextRetryAt: next };
}

/** Queue research for recent companies that were never researched (newest first). */
export async function scheduleBackfill(limit = 500) {
  const settings = await getSetting("research");
  if (!settings.enabled || settings.backfillDays <= 0) return 0;
  const cutoffs = new Map<string, string>();
  const companies = await Company.find({ isDemo: { $ne: true }, "research.status": { $in: ["NOT_STARTED", null] } })
    .select("_id countryCode registrationDay")
    .sort({ registrationDay: -1 })
    .limit(limit * 3)
    .lean<{ _id: Types.ObjectId; countryCode: string; registrationDay?: string }[]>();
  let n = 0;
  for (const c of companies) {
    if (!cutoffs.has(c.countryCode)) cutoffs.set(c.countryCode, addDays(todayIn(getCountry(c.countryCode)?.timezone ?? "UTC"), -settings.backfillDays));
    if (!c.registrationDay || c.registrationDay < cutoffs.get(c.countryCode)!) continue;
    await enqueueResearch(c._id, { reason: "backfill", registrationDay: c.registrationDay });
    if (++n >= limit) break;
  }
  return n;
}

registerJobHandler("research", async (payload) => {
  await researchCompany(String(payload.companyId), { reason: String(payload.reason ?? "") });
});
