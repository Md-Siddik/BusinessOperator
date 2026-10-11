import "server-only";
import type { Types } from "mongoose";
import { Opportunity, OpportunityEvent, type OpportunityDoc } from "@/models";
import { SOURCE_PRIORITY, type SourceClass } from "./constants";
import { findCompanyLink, type CompanyLink } from "./company-link";
import { canonicalUrlKey, hostOf, normalizeOrgName, normalizeRegNumber, normalizeTitle, registrableDomain, serviceCategoriesFromCpv, serviceCategoriesFromText, sha1 } from "./normalize";
import type { FeedLike, NormalizedOpportunity, OpportunityProvider } from "./providers/types";
import { computeActivity, deriveContactRoutes, looksLikeAgency, type DerivableRecord, deriveLabels, orgDomainOf, reviewReasons, type SourceVerificationStatus } from "./verification";

/**
 * Idempotent ingestion of normalized provider results.
 *  - one record per (provider, externalId); re-imports update in place
 *  - unchanged content (hash) only refreshes lastSeenAt
 *  - owner workflow fields (saved, notes, review, manual verification) are never touched
 *  - duplicates across providers are grouped, never deleted
 */

const DAY = 86_400_000;

/** How long a source confirmation counts as "active (checked)". */
export function freshnessMs(provider: Pick<OpportunityProvider, "recommendedIntervalMinutes">) {
  return Math.max(provider.recommendedIntervalMinutes * 3 * 60_000, 2 * DAY);
}

/** Providers whose records need periodic per-record status checks (no listing or explicit removals). */
export function needsPeriodicChecks(provider: OpportunityProvider) {
  return !!provider.checkActivity && provider.capabilities.removalDetection !== "EXPLICIT" && provider.capabilities.removalDetection !== "LISTING_DIFF";
}
export const CHECK_INTERVAL_MS = DAY;

type FeedVerification = { status?: string | null; evidenceUrl?: string | null; detail?: string | null; checkedAt?: Date | null } | null | undefined;

export function sourceVerificationFor(sourceClass: SourceClass, feedVerification: FeedVerification): { status: SourceVerificationStatus; detail: string; url?: string } {
  switch (sourceClass) {
    case "OFFICIAL_PROCUREMENT_PORTAL":
    case "OFFICIAL_PUBLIC_EMPLOYMENT_SERVICE":
      return { status: "AUTHORITATIVE_SOURCE", detail: "Retrieved from the publishing authority's official API." };
    case "OFFICIAL_EMPLOYER_SOURCE":
      return { status: "ON_OFFICIAL_DOMAIN", detail: "Published on the employer's official website domain." };
    case "OFFICIAL_EMPLOYER_ATS": {
      const s = feedVerification?.status;
      if (s === "LINKED_FROM_OFFICIAL_DOMAIN") return { status: "LINKED_FROM_OFFICIAL_DOMAIN", detail: feedVerification?.detail ?? "Board is linked from the employer's official website.", url: feedVerification?.evidenceUrl ?? undefined };
      if (s === "LINK_NOT_FOUND") return { status: "LINK_NOT_FOUND", detail: feedVerification?.detail ?? "No link to the board was found on the employer's official website." };
      return { status: "NOT_CHECKED", detail: s === "FETCH_FAILED" ? (feedVerification?.detail ?? "Employer website could not be read.") : "Board-to-domain link not yet checked." };
    }
    case "THIRD_PARTY_AGGREGATOR":
      return { status: "AGGREGATOR", detail: "Re-published by an aggregator; the original employer posting is not established." };
    default:
      return { status: "NOT_CHECKED", detail: "Publisher not verified." };
  }
}

/** Derived trust fields for a stored record — recomputed after every change. */
export function derivedFields(doc: DerivableRecord, provider: OpportunityProvider, now = new Date()) {
  const activity = computeActivity(doc, freshnessMs(provider), now);
  const reasons = reviewReasons(doc, activity);
  const labels = deriveLabels(doc, activity, reasons);
  return { activity, reviewReasons: reasons, labels };
}

function fallbackKeyFor(o: NormalizedOpportunity, orgKey: string | undefined): string | undefined {
  const title = normalizeTitle(o.title);
  if (!orgKey || !title || !o.countryCode) return undefined;
  if (o.type === "PROCUREMENT") {
    if (!o.deadline) return undefined;
    return sha1(`P|${o.countryCode}|${orgKey}|${title}|${o.deadline.toISOString().slice(0, 10)}`);
  }
  return sha1(`H|${o.countryCode}|${orgKey}|${title}`);
}

function contentHash(o: NormalizedOpportunity) {
  return sha1(
    JSON.stringify([o.title, o.organization, o.countryCode, o.location, o.summary, o.sourceUrl, o.applyUrl, o.thirdPartyUrl, o.sourceClass, o.publishedAt?.getTime(), o.sourceUpdatedAt?.getTime(), o.deadline?.getTime(), o.deadlineText, o.sourceSaysClosed, o.classification, o.jobCategory, o.employmentType, o.noticeKind, o.contacts]),
  );
}

export type IngestCounts = { created: number; updated: number; unchanged: number; duplicatesLinked: number; removed: number };

export type IngestContext = {
  provider: OpportunityProvider;
  feed: FeedLike & { verification?: FeedVerification };
  runId?: Types.ObjectId;
  now?: Date;
};

export async function ingestItems(items: NormalizedOpportunity[], ctx: IngestContext): Promise<IngestCounts & { seenIds: string[] }> {
  const now = ctx.now ?? new Date();
  const counts: IngestCounts = { created: 0, updated: 0, unchanged: 0, duplicatesLinked: 0, removed: 0 };
  const linkCache = new Map<string, CompanyLink | null>();
  const ownerCompanyId = (ctx.feed.config.companyId as string | undefined) ?? null;
  const seenIds: string[] = [];

  for (const o of items) {
    seenIds.push(o.externalId);
    const regNo = normalizeRegNumber(o.organization.registrationNumber);
    const normalizedName = normalizeOrgName(o.organization.name);
    const domain = orgDomainOf(o.organization.website, (o.contacts ?? []).filter((c) => c.kind === "ORGANIZATION_EMAIL" && !c.thirdParty).map((c) => c.email));
    const linkKey = `${o.organization.registrationCountry ?? ""}|${regNo ?? ""}|${domain ?? ""}`;
    let link = linkCache.get(linkKey);
    if (link === undefined) {
      link = await findCompanyLink({ registrationNumber: regNo, registrationCountry: o.organization.registrationCountry, domain }, ownerCompanyId);
      linkCache.set(linkKey, link);
    }
    const sv = sourceVerificationFor(o.sourceClass, ctx.feed.verification);
    // An agency's own registry match confirms the agency, not the hiring employer.
    const agencyPoster = o.type === "HIRING" && looksLikeAgency(o.organization.name);
    const confirmed = !agencyPoster && ((link && link.method !== "OWNER_LINKED") || sv.status === "LINKED_FROM_OFFICIAL_DOMAIN");
    const employerIdentity = confirmed ? "CONFIRMED" : regNo ? "REGISTRATION_NUMBER_PROVIDED" : "NOT_CONFIRMED";
    const contacts = (o.contacts ?? []).map((c) => ({ ...c, sourceProvider: ctx.provider.id, sourceUrl: o.sourceUrl, checkedAt: now }));
    const contactRoutes = deriveContactRoutes({ type: o.type, sourceClass: o.sourceClass, applyUrl: o.applyUrl, thirdPartyUrl: o.thirdPartyUrl, orgDomain: domain, contacts });
    const cpvCats = o.classification?.scheme === "CPV" ? serviceCategoriesFromCpv(o.classification.codes) : [];
    const textCats = cpvCats.length ? [] : serviceCategoriesFromText(o.title, o.jobCategory, o.classification?.labels?.join(" "));
    const urlKey = canonicalUrlKey(o.applyUrl && registrableDomain(hostOf(o.applyUrl)) !== registrableDomain(hostOf(o.thirdPartyUrl)) ? o.applyUrl : o.sourceUrl);
    const hash = contentHash(o);

    const fields = {
      type: o.type,
      feedId: ctx.feed._id,
      title: o.title,
      organization: { name: o.organization.name, normalizedName, registrationNumber: regNo, registrationCountry: o.organization.registrationCountry, website: o.organization.website, domain },
      countryCode: o.countryCode,
      location: o.location,
      summary: o.summary,
      sourceUrl: o.sourceUrl,
      applyUrl: o.applyUrl,
      canonicalUrlKey: urlKey,
      sourceClass: o.sourceClass,
      sourcePublisher: o.sourcePublisher,
      publishedAt: o.publishedAt,
      sourceUpdatedAt: o.sourceUpdatedAt,
      deadline: o.deadline,
      deadlineText: o.deadlineText,
      sourceSaysClosed: !!o.sourceSaysClosed,
      sourceVerification: { ...sv, at: now },
      employerIdentity,
      contacts,
      contactRoutes,
      hasDirectLink: contactRoutes.includes("DIRECT_APPLICATION") || contactRoutes.includes("PROCUREMENT_SUBMISSION"),
      hasContact: contactRoutes.some((r) => r === "NAMED_CONTACT_ON_NOTICE" || r === "OFFICIAL_COMPANY_CHANNEL"),
      classification: o.classification,
      jobCategory: o.jobCategory,
      employmentType: o.employmentType,
      serviceCategories: cpvCats.length ? cpvCats : textCats,
      serviceCategoryBasis: cpvCats.length ? "PUBLISHED_CLASSIFICATION" : textCats.length ? "PUBLISHED_TEXT_KEYWORDS" : "NONE",
      noticeKind: o.noticeKind,
      companyLink: link ? { ...link, at: now } : undefined,
      fallbackKey: fallbackKeyFor(o, regNo ?? normalizedName),
      contentHash: hash,
    };

    const existing = await Opportunity.findOne({ providerId: ctx.provider.id, externalId: o.externalId }).select("+contentHash").lean<OpportunityDoc & { contentHash?: string }>();
    const nextCheckAt = needsPeriodicChecks(ctx.provider) ? new Date(now.getTime() + CHECK_INTERVAL_MS) : undefined;

    if (!existing) {
      const base = { ...fields, sourceState: "LISTED" as const, lastSeenAt: now, lastCheckedAt: now, lastCheckResult: "Listed by source", firstSeenAt: now, nextCheckAt, manualVerification: undefined, consecutiveCheckFailures: 0 };
      const derived = derivedFields(base as never, ctx.provider, now);
      const evidence = [
        { kind: "SOURCE_PUBLISHER", result: sv.status === "LINK_NOT_FOUND" || sv.status === "AGGREGATOR" || sv.status === "NOT_CHECKED" ? "INCONCLUSIVE" : "PASS", detail: `${o.sourcePublisher}: ${sv.detail}`, url: sv.url ?? o.sourceUrl, at: now },
        ...(link
          ? [{ kind: "COMPANY_REGISTRY_MATCH", result: link.method === "OWNER_LINKED" ? "INCONCLUSIVE" : "PASS", detail: link.method === "REGISTRATION_NUMBER" ? `Registration number ${regNo} matches a Company Intelligence record.` : link.method === "OFFICIAL_DOMAIN" ? `Official domain ${domain} matches exactly one Company Intelligence record.` : "Company linked by the owner on the employer feed.", at: now }]
          : regNo
            ? [{ kind: "COMPANY_REGISTRY_MATCH", result: "INCONCLUSIVE", detail: `Source supplies registration number ${regNo}; no matching Company Intelligence record yet.`, at: now }]
            : []),
      ];
      try {
        const created = await Opportunity.create({ ...base, ...derived, providerId: ctx.provider.id, externalId: o.externalId, evidence, lastVerification: { result: derived.activity, detail: "Discovered in source listing", at: now } });
        counts.created++;
        await OpportunityEvent.create({ opportunityId: created._id, kind: "DISCOVERED", to: derived.activity, detail: `Discovered via ${ctx.provider.name}`, runId: ctx.runId, at: now });
        if (await assignDuplicateGroup(created.toObject() as OpportunityDoc)) counts.duplicatesLinked++;
      } catch (e) {
        // Concurrent insert of the same (provider, externalId): the unique index makes this idempotent.
        if ((e as { code?: number }).code !== 11000) throw e;
        counts.unchanged++;
      }
      continue;
    }

    const reappeared = existing.sourceState === "REMOVED_AT_SOURCE";
    const changed = existing.contentHash !== hash;
    const merged = { ...existing, ...(changed ? fields : {}), sourceState: "LISTED" as const, lastSeenAt: now, consecutiveCheckFailures: 0 };
    const derived = derivedFields(merged, ctx.provider, now);
    const set: Record<string, unknown> = {
      ...(changed ? fields : { companyLink: fields.companyLink ?? existing.companyLink, employerIdentity, sourceVerification: fields.sourceVerification }),
      ...derived,
      sourceState: "LISTED",
      lastSeenAt: now,
      lastCheckedAt: now,
      lastCheckResult: "Listed by source",
      consecutiveCheckFailures: 0,
      missingFromListings: 0,
      ...(nextCheckAt && { nextCheckAt }),
      ...(reappeared && { removedAt: null }),
    };
    if (existing.contentPurged) Object.assign(set, { contentPurged: false });
    await Opportunity.updateOne({ _id: existing._id }, { $set: set });
    if (changed) {
      counts.updated++;
      if (existing.deadline?.getTime() !== fields.deadline?.getTime()) await OpportunityEvent.create({ opportunityId: existing._id, kind: "DEADLINE_CHANGED", from: existing.deadline?.toISOString() ?? existing.deadlineText ?? "none", to: fields.deadline?.toISOString() ?? fields.deadlineText ?? "none", runId: ctx.runId, at: now });
      if (await assignDuplicateGroup({ ...existing, ...fields } as OpportunityDoc)) counts.duplicatesLinked++;
    } else counts.unchanged++;
    if (existing.activity !== derived.activity || reappeared) await OpportunityEvent.create({ opportunityId: existing._id, kind: reappeared ? "REAPPEARED_AT_SOURCE" : "ACTIVITY_CHANGED", from: existing.activity, to: derived.activity, runId: ctx.runId, at: now });
  }
  return { ...counts, seenIds };
}

/**
 * Group duplicates across providers. Matching (strict):
 *  - same canonical URL key (application / notice URL), or
 *  - same fallback key (country + registration number or normalized organization + normalized title
 *    [+ deadline day for procurement]) — only when the key is unique within each provider,
 *    so two genuinely separate postings with the same title are never folded together.
 * Returns true when the record joined an existing group.
 */
export async function assignDuplicateGroup(doc: Pick<OpportunityDoc, "_id" | "providerId" | "canonicalUrlKey" | "fallbackKey" | "dupGroup">): Promise<boolean> {
  const or: Record<string, unknown>[] = [];
  if (doc.canonicalUrlKey) or.push({ canonicalUrlKey: doc.canonicalUrlKey });
  if (doc.fallbackKey) or.push({ fallbackKey: doc.fallbackKey });
  if (!or.length) return false;
  const candidates = await Opportunity.find({ _id: { $ne: doc._id }, providerId: { $ne: doc.providerId }, $or: or })
    .select("_id providerId canonicalUrlKey fallbackKey dupGroup")
    .limit(20)
    .lean<Pick<OpportunityDoc, "_id" | "providerId" | "canonicalUrlKey" | "fallbackKey" | "dupGroup">[]>();
  const matches: { c: (typeof candidates)[number]; method: "CANONICAL_URL" | "FALLBACK_MATCH" }[] = [];
  for (const c of candidates) {
    if (doc.canonicalUrlKey && c.canonicalUrlKey === doc.canonicalUrlKey) {
      matches.push({ c, method: "CANONICAL_URL" });
      continue;
    }
    if (doc.fallbackKey && c.fallbackKey === doc.fallbackKey) {
      const [mine, theirs] = await Promise.all([
        Opportunity.countDocuments({ providerId: doc.providerId, fallbackKey: doc.fallbackKey }),
        Opportunity.countDocuments({ providerId: c.providerId, fallbackKey: doc.fallbackKey }),
      ]);
      if (mine === 1 && theirs === 1) matches.push({ c, method: "FALLBACK_MATCH" });
    }
  }
  if (!matches.length) return false;
  const group = matches.find((m) => m.c.dupGroup)?.c.dupGroup ?? doc.dupGroup ?? String(matches[0]!.c._id);
  const method = matches.some((m) => m.method === "CANONICAL_URL") ? "CANONICAL_URL" : "FALLBACK_MATCH";
  const ids = [doc._id, ...matches.map((m) => m.c._id)];
  await Opportunity.updateMany({ _id: { $in: ids } }, { $set: { dupGroup: group, dedupeMethod: method } });
  // Merge any other members already in the matched groups.
  const otherGroups = [...new Set(matches.map((m) => m.c.dupGroup).filter((g): g is string => !!g && g !== group))];
  if (otherGroups.length) await Opportunity.updateMany({ dupGroup: { $in: otherGroups } }, { $set: { dupGroup: group } });
  await electCanonical(group);
  return true;
}

/**
 * Pick the canonical record of a group: most authoritative source class, then earliest
 * discovery. Owner workflow state moves to the new canonical so nothing the owner did is hidden.
 */
export async function electCanonical(group: string) {
  const members = await Opportunity.find({ dupGroup: group }).select("_id sourceClass firstSeenAt isCanonical saved savedAt reviewStatus notes manualVerification lastNoteAt").lean<OpportunityDoc[]>();
  if (!members.length) return;
  const sorted = [...members].sort((a, b) => SOURCE_PRIORITY[a.sourceClass as SourceClass] - SOURCE_PRIORITY[b.sourceClass as SourceClass] || a.firstSeenAt.getTime() - b.firstSeenAt.getTime());
  const best = sorted[0]!;
  const previous = members.filter((m) => m.isCanonical && String(m._id) !== String(best._id));
  const transfer: Record<string, unknown> = {};
  const push: Record<string, unknown> = {};
  for (const p of previous) {
    if (p.saved && !best.saved) Object.assign(transfer, { saved: true, savedAt: p.savedAt });
    if (p.reviewStatus && p.reviewStatus !== "NEW" && (!best.reviewStatus || best.reviewStatus === "NEW")) transfer.reviewStatus = p.reviewStatus;
    if (p.manualVerification?.result && !best.manualVerification?.result) transfer.manualVerification = p.manualVerification;
    if (p.notes?.length) {
      push.notes = { $each: p.notes };
      transfer.lastNoteAt = p.lastNoteAt;
    }
  }
  await Opportunity.updateMany({ dupGroup: group, _id: { $ne: best._id } }, { $set: { isCanonical: false } });
  await Opportunity.updateOne({ _id: best._id }, { $set: { isCanonical: true, ...transfer }, ...(push.notes ? { $push: push } : {}) });
  if (previous.length && push.notes) await Opportunity.updateMany({ _id: { $in: previous.map((p) => p._id) } }, { $set: { notes: [], lastNoteAt: null } });
}

/** Apply removals the source reported explicitly (stream removal, INACTIVE status, 404 on check). */
export async function markRemoved(provider: OpportunityProvider, externalIds: string[], detail: string, runId?: Types.ObjectId, now = new Date()) {
  if (!externalIds.length) return 0;
  const docs = await Opportunity.find({ providerId: provider.id, externalId: { $in: externalIds }, sourceState: { $ne: "REMOVED_AT_SOURCE" } }).lean<OpportunityDoc[]>();
  for (const d of docs) {
    const next = { ...d, sourceState: "REMOVED_AT_SOURCE" as const };
    const derived = derivedFields(next, provider, now);
    const purge = provider.purgeOnRemoval
      ? { title: "(removed at source — content purged per source terms)", summary: null, contacts: [], applyUrl: null, location: null, contactRoutes: ["NONE"], hasContact: false, hasDirectLink: false, contentPurged: true }
      : {};
    await Opportunity.updateOne(
      { _id: d._id },
      {
        $set: { ...derived, ...purge, sourceState: "REMOVED_AT_SOURCE", removedAt: now, closedAt: d.closedAt ?? now, lastCheckedAt: now, lastCheckResult: detail, lastVerification: { result: "REMOVED", detail, at: now } },
        $push: { evidence: { $each: [{ kind: "REMOVAL", result: "PASS", detail, at: now }], $slice: -30 } },
      },
    );
    await OpportunityEvent.create({ opportunityId: d._id, kind: "REMOVED_AT_SOURCE", from: d.activity, to: derived.activity, detail, runId, at: now });
  }
  return docs.length;
}

/** Recompute derived trust fields for records matching a filter (bounded). */
export async function recomputeWhere(provider: OpportunityProvider, filter: Record<string, unknown>, now = new Date(), max = 5000) {
  const cursor = Opportunity.find({ providerId: provider.id, ...filter }).limit(max).lean<OpportunityDoc[]>().cursor();
  let ops: Parameters<typeof Opportunity.bulkWrite>[0] = [];
  let n = 0;
  const events: Record<string, unknown>[] = [];
  for await (const d of cursor) {
    const derived = derivedFields(d, provider, now);
    if (derived.activity !== d.activity) events.push({ opportunityId: d._id, kind: "ACTIVITY_CHANGED", from: d.activity, to: derived.activity, detail: derived.activity === "EXPIRED" ? "Published deadline passed" : derived.activity === "UNKNOWN" ? "No source confirmation within the freshness window" : undefined, at: now });
    const extra = (derived.activity === "EXPIRED" || derived.activity === "CLOSED") && !d.closedAt ? { closedAt: now } : {};
    ops.push({ updateOne: { filter: { _id: d._id }, update: { $set: { ...derived, ...extra } } } });
    n++;
    if (ops.length >= 500) {
      await Opportunity.bulkWrite(ops);
      ops = [];
    }
  }
  if (ops.length) await Opportunity.bulkWrite(ops);
  if (events.length) await OpportunityEvent.insertMany(events);
  return n;
}
