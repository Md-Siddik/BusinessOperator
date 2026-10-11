import "server-only";
import { Types, type FilterQuery } from "mongoose";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { isOwner, type Actor } from "@/lib/permissions";
import { parseObjectId } from "@/lib/validation";
import { todayIn, addDays, isDay } from "@/lib/dates/country-time";
import { getOpportunityCountry, OPPORTUNITY_COUNTRIES, OPPORTUNITY_COUNTRY_CODES } from "@/config/opportunity-countries";
import { Company, CrmActivity, Opportunity, OpportunityEvent, OpportunityFeed, OpportunitySyncRun, type CompanyDoc, type OpportunityDoc, type OpportunityEventDoc, type OpportunityFeedDoc, type OpportunitySyncRunDoc } from "@/models";
import {
  ACTIVITY_STATUSES,
  CONTACT_ROUTE_LABELS,
  DATE_FIELD_LABELS,
  DATE_FIELD_PATHS,
  DATE_FIELDS,
  EMPLOYER_IDENTITY,
  MANUAL_VERIFICATION_RESULTS,
  MAX_PAGE_SIZE,
  OFFICIAL_SOURCE_CLASSES,
  OPP_DATE_PRESETS,
  OPPORTUNITY_TYPES,
  REVIEW_STATUSES,
  SERVICE_CATEGORIES,
  SOURCE_CLASS_LABELS,
  SOURCE_CLASSES,
  VERIFICATION_LABEL_TEXT,
  VERIFICATION_LABELS,
  type CountrySupport,
  type CoverageLevel,
  type OpportunityType,
  type ProviderState,
  type SourceClass,
} from "./constants";
import { csvCell } from "@/features/companies/registrations";
import { derivedFields } from "./ingest";
import { CANDIDATE_SOURCES, getOpportunityProvider, OPPORTUNITY_PROVIDERS } from "./providers";
import { summarizeOpportunityProvider, type OpportunityProviderSummary } from "./providers/types";
import { checkOpportunity, enqueueFeedSync, ensureProviderFeeds, verifyEmployerFeed } from "./sync";

/**
 * Verified Opportunity Intelligence — OWNER-ONLY service layer.
 * Every exported function verifies the actor's actual role server-side before touching data.
 * Non-owners get 403 (401 when unauthenticated); record ids never reveal existence to them.
 */
export function assertOwner(actor: Actor | null | undefined): asserts actor is Actor {
  if (!actor) throw Errors.unauthorized();
  if (!isOwner(actor)) throw Errors.forbidden();
}

/* ───────────────────────── Query & filters ───────────────────────── */

const yesNo = z.enum(["yes", "no"]).optional();
export const opportunityQuerySchema = z.object({
  type: z.enum(OPPORTUNITY_TYPES).optional(),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => OPPORTUNITY_COUNTRY_CODES.includes(v), "Unsupported country")
    .optional(),
  source: z.enum(SOURCE_CLASSES).optional(),
  provider: z.string().max(40).optional(),
  employer: z.enum(EMPLOYER_IDENTITY).optional(),
  label: z.enum(VERIFICATION_LABELS).optional(),
  /** "open" (default) = ACTIVE or UNKNOWN; "all" = any. */
  activity: z.enum([...ACTIVITY_STATUSES, "open", "all"]).default("open"),
  dateField: z.enum(DATE_FIELDS).default("discovered"),
  preset: z.enum(OPP_DATE_PRESETS).optional(),
  from: z.string().refine(isDay, "Use YYYY-MM-DD").optional(),
  to: z.string().refine(isDay, "Use YYYY-MM-DD").optional(),
  category: z.enum(SERVICE_CATEGORIES).optional(),
  jobCategory: z.string().trim().max(100).optional(),
  company: z.string().trim().max(120).optional(),
  q: z.string().trim().max(200).optional(),
  direct: yesNo,
  contact: yesNo,
  saved: yesNo,
  notes: yesNo,
  review: z.enum(REVIEW_STATUSES).optional(),
  linked: yesNo,
  archived: z.enum(["exclude", "include", "only"]).default("exclude"),
  sort: z.enum(["discovered", "published", "deadline", "checked"]).default("discovered"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
});
export type OpportunityQuery = z.infer<typeof opportunityQuerySchema>;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Midnight of `day` in `timeZone`, as a UTC instant. */
export function zonedDayStart(day: string, timeZone: string): Date {
  const guess = new Date(`${day}T00:00:00Z`);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const parts = Object.fromEntries(fmt.formatToParts(guess).map((p) => [p.type, p.value]));
  const asIfUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return new Date(guess.getTime() - (asIfUtc - guess.getTime()));
}

export type DateWindow = { field: string; label: string; timeZone: string; from?: Date; to?: Date; description: string };

/**
 * Date window for a filter. The calendar day is evaluated in the selected country's
 * time zone (UTC when no country is selected) and applied to exactly one timestamp field.
 * For deadlines, presets look forward (Today = due today, 7d = due within the next 7 days).
 */
export function dateWindow(q: Pick<OpportunityQuery, "dateField" | "preset" | "from" | "to" | "country">, now = new Date()): DateWindow | null {
  if (!q.preset) return null;
  const timeZone = getOpportunityCountry(q.country)?.timezone ?? "UTC";
  const today = todayIn(timeZone, now);
  const forward = q.dateField === "deadline";
  let fromDay: string | undefined;
  let toDay: string | undefined;
  if (q.preset === "today") [fromDay, toDay] = [today, today];
  else if (q.preset === "7d") [fromDay, toDay] = forward ? [today, addDays(today, 6)] : [addDays(today, -6), today];
  else if (q.preset === "30d") [fromDay, toDay] = forward ? [today, addDays(today, 29)] : [addDays(today, -29), today];
  else [fromDay, toDay] = [q.from, q.to];
  if (!fromDay && !toDay) return null;
  const from = fromDay ? zonedDayStart(fromDay, timeZone) : undefined;
  const to = toDay ? zonedDayStart(addDays(toDay, 1), timeZone) : undefined;
  const label = DATE_FIELD_LABELS[q.dateField];
  const span = fromDay === toDay ? fromDay : `${fromDay ?? "…"} to ${toDay ?? "…"}`;
  return { field: DATE_FIELD_PATHS[q.dateField], label, timeZone, from, to, description: `${label}: ${span} (calendar days in ${timeZone})` };
}

export function buildOpportunityFilter(q: OpportunityQuery, now = new Date()): FilterQuery<OpportunityDoc> {
  const and: FilterQuery<OpportunityDoc>[] = [{ isCanonical: true }];
  if (q.type) and.push({ type: q.type });
  if (q.country) and.push({ countryCode: q.country });
  if (q.source) and.push({ sourceClass: q.source });
  if (q.provider) and.push({ providerId: q.provider });
  if (q.employer) and.push({ employerIdentity: q.employer });
  if (q.label) and.push({ labels: q.label });
  if (q.activity === "open") and.push({ activity: { $in: ["ACTIVE", "UNKNOWN"] } });
  else if (q.activity !== "all") and.push({ activity: q.activity });
  const w = dateWindow(q, now);
  if (w) and.push({ [w.field]: { ...(w.from && { $gte: w.from }), ...(w.to && { $lt: w.to }) } });
  if (q.category) and.push({ serviceCategories: q.category });
  if (q.jobCategory) and.push({ jobCategory: new RegExp(escapeRe(q.jobCategory), "i") });
  if (q.company) and.push({ "organization.name": new RegExp(escapeRe(q.company), "i") });
  if (q.q) and.push({ $text: { $search: q.q } });
  if (q.direct === "yes") and.push({ hasDirectLink: true });
  if (q.direct === "no") and.push({ hasDirectLink: false });
  if (q.contact === "yes") and.push({ hasContact: true });
  if (q.contact === "no") and.push({ hasContact: false });
  if (q.saved === "yes") and.push({ saved: true });
  if (q.saved === "no") and.push({ saved: { $ne: true } });
  if (q.notes === "yes") and.push({ "notes.0": { $exists: true } });
  if (q.review) and.push({ reviewStatus: q.review });
  if (q.linked === "yes") and.push({ "companyLink.companyId": { $exists: true } });
  if (q.linked === "no") and.push({ "companyLink.companyId": { $exists: false } });
  if (q.archived === "exclude") and.push({ archivedAt: null });
  if (q.archived === "only") and.push({ archivedAt: { $ne: null } });
  return { $and: and };
}

const SORTS: Record<OpportunityQuery["sort"], Record<string, 1 | -1>> = {
  discovered: { firstSeenAt: -1, _id: -1 },
  published: { publishedAt: -1, firstSeenAt: -1, _id: -1 },
  deadline: { deadline: 1, _id: 1 },
  checked: { lastSeenAt: -1, _id: -1 },
};

const LIST_FIELDS =
  "type providerId title organization countryCode location sourceUrl applyUrl sourceClass sourcePublisher publishedAt firstSeenAt lastSeenAt lastCheckedAt deadline deadlineText activity sourceState employerIdentity labels contactRoutes hasDirectLink hasContact serviceCategories serviceCategoryBasis jobCategory noticeKind saved reviewStatus manualVerification.result companyLink dupGroup archivedAt lastNoteAt";

export type OpportunityListItem = Pick<
  OpportunityDoc,
  "_id" | "type" | "providerId" | "title" | "organization" | "countryCode" | "location" | "sourceUrl" | "applyUrl" | "sourceClass" | "sourcePublisher" | "publishedAt" | "firstSeenAt" | "lastSeenAt" | "lastCheckedAt" | "deadline" | "deadlineText" | "activity" | "sourceState" | "employerIdentity" | "labels" | "contactRoutes" | "hasDirectLink" | "hasContact" | "serviceCategories" | "serviceCategoryBasis" | "jobCategory" | "noticeKind" | "saved" | "reviewStatus" | "manualVerification" | "companyLink" | "dupGroup" | "archivedAt" | "lastNoteAt"
> & { duplicateCount: number };

/**
 * Parse list filters. Empty values (an "All" option in the GET filter form submits `country=`)
 * mean "no filter" and are dropped. Strict mode (API) rejects invalid values with 400; lenient
 * mode (pages) drops invalid parameters and reports them instead of failing the whole page.
 */
export function parseOpportunityQuery(input: unknown, opts: { lenient?: boolean } = {}): { query: OpportunityQuery; ignored: string[] } {
  const clean: Record<string, unknown> = Object.fromEntries(Object.entries((input ?? {}) as Record<string, unknown>).filter(([, v]) => v !== "" && v !== null && v !== undefined));
  if (!opts.lenient) return { query: opportunityQuerySchema.parse(clean), ignored: [] };
  const first = opportunityQuerySchema.safeParse(clean);
  if (first.success) return { query: first.data, ignored: [] };
  const ignored = [...new Set(first.error.issues.map((i) => String(i.path[0])))];
  for (const k of ignored) delete clean[k];
  return { query: opportunityQuerySchema.parse(clean), ignored };
}

export async function listOpportunities(actor: Actor | null, input: unknown, opts: { lenient?: boolean } = {}) {
  assertOwner(actor);
  const { query: q, ignored } = parseOpportunityQuery(input, opts);
  const now = new Date();
  const filter = buildOpportunityFilter(q, now);
  const [total, docs] = await Promise.all([
    Opportunity.countDocuments(filter),
    Opportunity.find(filter)
      .select(LIST_FIELDS)
      .sort(SORTS[q.sort])
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .lean<OpportunityDoc[]>(),
  ]);
  const groups = docs.map((d) => d.dupGroup).filter((g): g is string => !!g);
  const dupCounts = groups.length ? await Opportunity.aggregate<{ _id: string; n: number }>([{ $match: { dupGroup: { $in: groups } } }, { $group: { _id: "$dupGroup", n: { $sum: 1 } } }]) : [];
  const dupMap = new Map(dupCounts.map((d) => [d._id, d.n - 1]));
  return {
    items: docs.map((d) => ({ ...d, duplicateCount: d.dupGroup ? (dupMap.get(d.dupGroup) ?? 0) : 0 })) as OpportunityListItem[],
    total,
    page: q.page,
    pageSize: q.pageSize,
    pageCount: Math.max(1, Math.ceil(total / q.pageSize)),
    query: q,
    ignored,
    dateWindow: dateWindow(q, now),
  };
}

/* ───────────────────────── Metrics ───────────────────────── */

export type OpportunityStats = {
  periodDays: number;
  discovered: number;
  discoveredByType: Record<OpportunityType, number>;
  activeChecked: number;
  official: number;
  deadlines: number;
  review: number;
  closed: number;
  removed: number;
  duplicates: number;
  syncFailures: number;
  hiringOrgs: number;
  openByType: Record<OpportunityType, number>;
  total: number;
};

/** Every number is a count over stored records with the documented definition (constants.METRIC_DEFINITIONS). */
export async function getOpportunityStats(actor: Actor | null, opts: { periodDays?: number; country?: string; type?: OpportunityType } = {}): Promise<OpportunityStats> {
  assertOwner(actor);
  const periodDays = Math.min(Math.max(opts.periodDays ?? 7, 1), 365);
  const now = new Date();
  const since = new Date(now.getTime() - periodDays * 86_400_000);
  const base: FilterQuery<OpportunityDoc> = { isCanonical: true, archivedAt: null, ...(opts.country && { countryCode: opts.country.toUpperCase() }), ...(opts.type && { type: opts.type }) };
  const open = { activity: { $in: ["ACTIVE", "UNKNOWN"] } };
  const [discoveredAgg, activeChecked, official, deadlines, review, closed, removed, duplicates, syncFailures, hiringOrgsAgg, openAgg, total] = await Promise.all([
    Opportunity.aggregate<{ _id: OpportunityType; n: number }>([{ $match: { ...base, firstSeenAt: { $gte: since } } }, { $group: { _id: "$type", n: { $sum: 1 } } }]),
    Opportunity.countDocuments({ ...base, activity: "ACTIVE" }),
    Opportunity.countDocuments({ ...base, ...open, sourceClass: { $in: OFFICIAL_SOURCE_CLASSES } }),
    Opportunity.countDocuments({ ...base, ...open, type: "PROCUREMENT", deadline: { $gte: now, $lte: new Date(now.getTime() + 14 * 86_400_000) } }),
    Opportunity.countDocuments({ ...base, labels: "NEEDS_MANUAL_REVIEW" }),
    Opportunity.countDocuments({ ...base, activity: { $in: ["CLOSED", "EXPIRED"] } }),
    Opportunity.countDocuments({ ...base, sourceState: "REMOVED_AT_SOURCE" }),
    Opportunity.countDocuments({ isCanonical: false, ...(opts.country && { countryCode: opts.country.toUpperCase() }), ...(opts.type && { type: opts.type }) }),
    OpportunitySyncRun.countDocuments({ status: "FAILED", startedAt: { $gte: since } }),
    Opportunity.aggregate<{ n: number }>([
      { $match: { ...base, ...open, type: "HIRING" } },
      { $group: { _id: { $ifNull: ["$organization.registrationNumber", "$organization.normalizedName"] } } },
      { $match: { _id: { $ne: null } } },
      { $count: "n" },
    ]),
    Opportunity.aggregate<{ _id: OpportunityType; n: number }>([{ $match: { ...base, ...open } }, { $group: { _id: "$type", n: { $sum: 1 } } }]),
    Opportunity.countDocuments(base),
  ]);
  const byType = (rows: { _id: OpportunityType; n: number }[]) => ({ HIRING: rows.find((r) => r._id === "HIRING")?.n ?? 0, PROCUREMENT: rows.find((r) => r._id === "PROCUREMENT")?.n ?? 0 });
  const discoveredByType = byType(discoveredAgg);
  return {
    periodDays,
    discovered: discoveredByType.HIRING + discoveredByType.PROCUREMENT,
    discoveredByType,
    activeChecked,
    official,
    deadlines,
    review,
    closed,
    removed,
    duplicates,
    syncFailures,
    hiringOrgs: hiringOrgsAgg[0]?.n ?? 0,
    openByType: byType(openAgg),
    total,
  };
}

/* ───────────────────────── Detail & owner actions ───────────────────────── */

export async function getOpportunityDetail(actor: Actor | null, id: string) {
  assertOwner(actor);
  const doc = await Opportunity.findById(parseObjectId(id)).lean<OpportunityDoc>();
  if (!doc) throw Errors.notFound();
  const [group, events, company, feed] = await Promise.all([
    doc.dupGroup ? Opportunity.find({ dupGroup: doc.dupGroup, _id: { $ne: doc._id } }).select("providerId sourceClass sourcePublisher sourceUrl applyUrl publishedAt firstSeenAt lastSeenAt activity sourceState isCanonical dedupeMethod deadline").lean<OpportunityDoc[]>() : Promise.resolve([]),
    OpportunityEvent.find({ opportunityId: doc._id }).sort({ at: -1 }).limit(100).lean<OpportunityEventDoc[]>(),
    doc.companyLink?.companyId ? Company.findById(doc.companyLink.companyId).select("companyName registrationNumber countryCode registrationDay website lead.stage").lean<CompanyDoc>() : Promise.resolve(null),
    doc.feedId ? OpportunityFeed.findById(doc.feedId).select("key label kind providerId verification health").lean<OpportunityFeedDoc>() : Promise.resolve(null),
  ]);
  const provider = getOpportunityProvider(doc.providerId);
  return { opportunity: doc, duplicates: group, events, company, feed, provider: provider ? summarizeOpportunityProvider(provider) : null };
}

const updateSchema = z.object({ saved: z.boolean().optional(), reviewStatus: z.enum(REVIEW_STATUSES).optional() });

export async function updateOpportunity(actor: Actor | null, id: string, input: unknown) {
  assertOwner(actor);
  const body = updateSchema.parse(input);
  const _id = parseObjectId(id);
  const doc = await Opportunity.findById(_id).select("saved reviewStatus").lean<OpportunityDoc>();
  if (!doc) throw Errors.notFound();
  const set: Record<string, unknown> = {};
  if (body.saved !== undefined) Object.assign(set, { saved: body.saved, savedAt: body.saved ? new Date() : null });
  if (body.reviewStatus) set.reviewStatus = body.reviewStatus;
  if (!Object.keys(set).length) return { ok: true };
  await Opportunity.updateOne({ _id }, { $set: set });
  if (body.reviewStatus && body.reviewStatus !== doc.reviewStatus) await OpportunityEvent.create({ opportunityId: _id, kind: "REVIEW_STATUS", from: doc.reviewStatus, to: body.reviewStatus, actorId: actor.id });
  if (body.saved !== undefined && body.saved !== doc.saved) await OpportunityEvent.create({ opportunityId: _id, kind: body.saved ? "SAVED" : "UNSAVED", actorId: actor.id });
  return { ok: true };
}

export async function addOpportunityNote(actor: Actor | null, id: string, input: unknown) {
  assertOwner(actor);
  const { text } = z.object({ text: z.string().trim().min(1, "Write a note").max(5000) }).parse(input);
  const _id = parseObjectId(id);
  const res = await Opportunity.updateOne({ _id }, { $push: { notes: { text, at: new Date(), by: new Types.ObjectId(actor.id) } }, $set: { lastNoteAt: new Date() } });
  if (!res.matchedCount) throw Errors.notFound();
  return { ok: true };
}

export async function deleteOpportunityNote(actor: Actor | null, id: string, noteId: string) {
  assertOwner(actor);
  const res = await Opportunity.updateOne({ _id: parseObjectId(id) }, { $pull: { notes: { _id: parseObjectId(noteId) } } });
  if (!res.matchedCount) throw Errors.notFound();
  return { ok: true };
}

export async function verifyOpportunityManually(actor: Actor | null, id: string, input: unknown) {
  assertOwner(actor);
  const body = z.object({ result: z.enum(MANUAL_VERIFICATION_RESULTS), note: z.string().trim().max(2000).optional() }).parse(input);
  const doc = await Opportunity.findById(parseObjectId(id)).lean<OpportunityDoc>();
  if (!doc) throw Errors.notFound();
  const provider = getOpportunityProvider(doc.providerId);
  const now = new Date();
  const manualVerification = { result: body.result, note: body.note, at: now, by: new Types.ObjectId(actor.id) };
  const derived = provider ? derivedFields({ ...doc, manualVerification }, provider, now) : {};
  await Opportunity.updateOne(
    { _id: doc._id },
    {
      $set: { manualVerification, ...derived, ...(body.result === "NOT_GENUINE" && { reviewStatus: "NOT_RELEVANT" }) },
      $push: { evidence: { $each: [{ kind: "MANUAL", result: body.result === "CONFIRMED_GENUINE" ? "PASS" : body.result === "NOT_GENUINE" ? "FAIL" : "INCONCLUSIVE", detail: `Owner review: ${body.result.replace(/_/g, " ").toLowerCase()}${body.note ? ` — ${body.note}` : ""}`, at: now }], $slice: -30 } },
    },
  );
  await OpportunityEvent.create({ opportunityId: doc._id, kind: "MANUAL_VERIFICATION", from: doc.manualVerification?.result ?? undefined, to: body.result, detail: body.note, actorId: actor.id, at: now });
  return { ok: true };
}

export async function recheckOpportunity(actor: Actor | null, id: string) {
  assertOwner(actor);
  const _id = parseObjectId(id);
  if (!(await Opportunity.exists({ _id }))) throw Errors.notFound();
  const res = await checkOpportunity(_id);
  return res ?? { status: "UNKNOWN", detail: "Not checked" };
}

/**
 * Save to the existing CRM: requires a reliable company link. Writes a CRM note that keeps
 * the source, evidence summary and contact provenance. This deliberately shares a summary
 * with CRM users (the owner's explicit choice), never the full private record.
 */
export async function addOpportunityToCrm(actor: Actor | null, id: string) {
  assertOwner(actor);
  const doc = await Opportunity.findById(parseObjectId(id)).lean<OpportunityDoc>();
  if (!doc) throw Errors.notFound();
  if (!doc.companyLink?.companyId) throw Errors.badRequest("Link this opportunity to a Company Intelligence record first (registration number or official domain). Companies are never matched by name alone.");
  const company = await Company.findById(doc.companyLink.companyId).select("countryCode isDemo lead").lean<CompanyDoc>();
  if (!company) throw Errors.badRequest("The linked company record no longer exists.");
  const contacts = (doc.contacts ?? []).map((c) => ({ kind: c.kind, name: c.name, role: c.role, email: c.email, phone: c.phone, url: c.url, source: c.sourceProvider, sourceUrl: c.sourceUrl, checkedAt: c.checkedAt, thirdParty: c.thirdParty }));
  const labels = (doc.labels ?? []).map((l) => VERIFICATION_LABEL_TEXT[l as keyof typeof VERIFICATION_LABEL_TEXT] ?? l);
  const body = [
    `${doc.type === "HIRING" ? "Hiring" : "Service/project opportunity"}: ${doc.title}`,
    `Source: ${doc.sourcePublisher} (${SOURCE_CLASS_LABELS[doc.sourceClass as SourceClass]})${doc.sourceUrl ? ` — ${doc.sourceUrl}` : ""}`,
    doc.applyUrl ? `Application / submission: ${doc.applyUrl}` : null,
    doc.deadline ? `Deadline: ${doc.deadline.toISOString().slice(0, 10)}` : doc.deadlineText ? `Deadline (as published): ${doc.deadlineText}` : null,
    `Verification: ${labels.join(", ") || "none"}`,
    `Contact routes: ${(doc.contactRoutes ?? []).map((r) => CONTACT_ROUTE_LABELS[r as keyof typeof CONTACT_ROUTE_LABELS] ?? r).join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");
  await CrmActivity.create({
    companyId: company._id,
    countryCode: company.countryCode,
    type: "NOTE",
    body: body.slice(0, 5000),
    meta: { opportunityId: String(doc._id), providerId: doc.providerId, sourceClass: doc.sourceClass, sourceUrl: doc.sourceUrl, labels: doc.labels, evidence: (doc.evidence ?? []).slice(-5), contacts, publishedAt: doc.publishedAt, firstSeenAt: doc.firstSeenAt, lastSeenAt: doc.lastSeenAt },
    actorId: actor.id,
    isDemo: !!company.isDemo,
  });
  if (!company.lead?.saved) await Company.updateOne({ _id: company._id }, { $set: { "lead.saved": true, "lead.savedAt": new Date() } });
  await Opportunity.updateOne({ _id: doc._id }, { $set: { crmSyncedAt: new Date() } });
  await OpportunityEvent.create({ opportunityId: doc._id, kind: "ADDED_TO_CRM", actorId: actor.id });
  await audit(actor, "opportunity.added_to_crm", { entityType: "Opportunity", entityId: String(doc._id), countryCode: company.countryCode });
  return { ok: true, companyId: String(company._id) };
}

const bulkSchema = z.object({
  ids: z.array(z.string()).min(1).max(200),
  action: z.enum(["save", "unsave", "review"]),
  reviewStatus: z.enum(REVIEW_STATUSES).optional(),
});

export async function bulkUpdateOpportunities(actor: Actor | null, input: unknown) {
  assertOwner(actor);
  const body = bulkSchema.parse(input);
  const ids = body.ids.map((i) => parseObjectId(i));
  let set: Record<string, unknown>;
  if (body.action === "save") set = { saved: true, savedAt: new Date() };
  else if (body.action === "unsave") set = { saved: false, savedAt: null };
  else {
    if (!body.reviewStatus) throw Errors.badRequest("Choose a review status.");
    set = { reviewStatus: body.reviewStatus };
  }
  const res = await Opportunity.updateMany({ _id: { $in: ids } }, { $set: set });
  await OpportunityEvent.insertMany(ids.map((id) => ({ opportunityId: id, kind: body.action === "review" ? "REVIEW_STATUS" : body.action === "save" ? "SAVED" : "UNSAVED", to: body.reviewStatus, detail: "Bulk action", actorId: actor.id })));
  await audit(actor, "opportunity.bulk_update", { entityType: "Opportunity", metadata: { action: body.action, reviewStatus: body.reviewStatus, count: res.modifiedCount } });
  return { updated: res.modifiedCount };
}

const EXPORT_MAX = 5000;

/** CSV export of the filtered list (owner only, audited). */
export async function exportOpportunitiesCsv(actor: Actor | null, input: unknown) {
  assertOwner(actor);
  const { query: q } = parseOpportunityQuery({ ...(input as object), page: 1, pageSize: MAX_PAGE_SIZE });
  const rows = await Opportunity.find(buildOpportunityFilter(q)).select(LIST_FIELDS).sort(SORTS[q.sort]).limit(EXPORT_MAX).lean<OpportunityDoc[]>();
  const header = ["Type", "Title", "Organization", "Registration number", "Country", "Location", "Source", "Source class", "Source URL", "Application / submission URL", "Published (source)", "First discovered", "Last confirmed at source", "Deadline", "Activity", "Employer identity", "Verification labels", "Contact routes", "Service categories", "Saved", "Review status"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.type,
        r.title,
        r.organization?.name,
        r.organization?.registrationNumber,
        r.countryCode,
        r.location,
        r.sourcePublisher,
        r.sourceClass,
        r.sourceUrl,
        r.applyUrl,
        r.publishedAt?.toISOString(),
        r.firstSeenAt?.toISOString(),
        r.lastSeenAt?.toISOString(),
        r.deadline?.toISOString() ?? r.deadlineText,
        r.activity,
        r.employerIdentity,
        (r.labels ?? []).join("|"),
        (r.contactRoutes ?? []).join("|"),
        (r.serviceCategories ?? []).join("|"),
        r.saved ? "yes" : "no",
        r.reviewStatus,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  await audit(actor, "opportunity.exported", { entityType: "Opportunity", metadata: { rows: rows.length, truncated: rows.length >= EXPORT_MAX, type: q.type, country: q.country } });
  return { csv: lines.join("\n"), rows: rows.length, truncated: rows.length >= EXPORT_MAX };
}

/* ───────────────────────── Feeds, providers & coverage ───────────────────────── */

export type FeedView = {
  id: string;
  key: string;
  providerId: string;
  kind: "PROVIDER" | "EMPLOYER";
  label: string;
  enabled: boolean;
  config: Record<string, unknown>;
  settings: Record<string, unknown>;
  intervalMinutes: number;
  nextRunAt: Date | null;
  running: boolean;
  health: OpportunityFeedDoc["health"];
  verification: OpportunityFeedDoc["verification"];
  state: ProviderState;
  stateMessage?: string;
  records: number;
};

function feedState(f: OpportunityFeedDoc, p: OpportunityProviderSummary, now = new Date()): { state: ProviderState; message?: string } {
  if (!p.configured.ok) return { state: "NEEDS_CREDENTIALS", message: p.configured.message ?? `Missing ${p.configured.missing.join(", ")}` };
  if (p.requiresAgreement && !f.enabled) return { state: "NEEDS_AGREEMENT", message: "Commercial use requires an agreement with the provider — enable only after confirming the terms." };
  if (!f.enabled) return { state: "DISABLED" };
  if (f.health?.lastRunStatus === "FAILED" && (f.health?.consecutiveFailures ?? 0) > 0) return { state: "PROVIDER_ERROR", message: f.health?.lastError ?? "Last run failed" };
  if (!f.health?.lastSuccessAt) return { state: "CONFIGURED_NOT_SYNCED" };
  const interval = (f.intervalMinutes ?? p.recommendedIntervalMinutes) * 60_000;
  if (now.getTime() - f.health.lastSuccessAt.getTime() > Math.max(interval * 4, 6 * 3_600_000)) return { state: "PROVIDER_ERROR", message: `No successful sync since ${f.health.lastSuccessAt.toISOString()}` };
  return { state: "OPERATIONAL" };
}

export async function listFeeds(actor: Actor | null): Promise<{ feeds: FeedView[]; providers: OpportunityProviderSummary[] }> {
  assertOwner(actor);
  await ensureProviderFeeds();
  const [feeds, counts] = await Promise.all([
    OpportunityFeed.find().sort({ kind: -1, createdAt: 1 }).lean<OpportunityFeedDoc[]>(),
    Opportunity.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { archivedAt: null } }, { $group: { _id: "$feedId", n: { $sum: 1 } } }]),
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.n]));
  const providers = OPPORTUNITY_PROVIDERS.map(summarizeOpportunityProvider);
  const now = new Date();
  const views = feeds
    .map((f): FeedView | null => {
      const p = providers.find((x) => x.id === f.providerId);
      if (!p) return null;
      const s = feedState(f, p, now);
      return {
        id: String(f._id),
        key: f.key,
        providerId: f.providerId,
        kind: f.kind as "PROVIDER" | "EMPLOYER",
        label: f.label ?? p.name,
        enabled: !!f.enabled,
        config: (f.config ?? {}) as Record<string, unknown>,
        settings: (f.settings ?? {}) as Record<string, unknown>,
        intervalMinutes: f.intervalMinutes ?? p.recommendedIntervalMinutes,
        nextRunAt: f.nextRunAt ?? null,
        running: !!f.lockedUntil && f.lockedUntil > now,
        health: f.health,
        verification: f.verification,
        state: s.state,
        stateMessage: s.message,
        records: countMap.get(String(f._id)) ?? 0,
      };
    })
    .filter((v): v is FeedView => !!v);
  return { feeds: views, providers };
}

const createFeedSchema = z.object({ providerId: z.string().max(40), config: z.record(z.string(), z.unknown()), companyId: z.string().optional() });

export async function createEmployerFeed(actor: Actor | null, input: unknown) {
  assertOwner(actor);
  const body = createFeedSchema.parse(input);
  const provider = getOpportunityProvider(body.providerId);
  if (!provider?.perEmployer || !provider.validateFeedConfig) throw Errors.badRequest("This provider does not take employer feeds.");
  let config: Record<string, unknown>;
  try {
    config = provider.validateFeedConfig(body.config);
  } catch (e) {
    throw Errors.badRequest(e instanceof Error ? e.message : "Invalid configuration");
  }
  if (body.companyId) {
    if (!(await Company.exists({ _id: parseObjectId(body.companyId) }))) throw Errors.badRequest("Company record not found.");
    config.companyId = body.companyId;
  }
  const key = `${provider.id}:${String(config.token ?? config.careersUrl).toLowerCase()}`;
  if (await OpportunityFeed.exists({ key })) throw Errors.conflict("This employer feed already exists.");
  const feed = await OpportunityFeed.create({
    key,
    providerId: provider.id,
    kind: "EMPLOYER",
    label: `${String(config.employerName)} — ${provider.name}`,
    enabled: true,
    config,
    settings: {},
    intervalMinutes: provider.recommendedIntervalMinutes,
    nextRunAt: new Date(),
    createdBy: actor.id,
  });
  await audit(actor, "opportunity.feed_created", { entityType: "OpportunityFeed", entityId: String(feed._id), metadata: { providerId: provider.id } });
  // Verify the board/domain link and run the first sync in the background.
  void verifyEmployerFeed(feed._id).catch(() => undefined);
  await enqueueFeedSync(String(feed._id), actor.id);
  return { id: String(feed._id) };
}

const updateFeedSchema = z.object({
  enabled: z.boolean().optional(),
  intervalMinutes: z.number().int().min(15).max(7 * 24 * 60).optional(),
  settings: z.record(z.string(), z.union([z.string().max(2000), z.number()])).optional(),
  acknowledgeTerms: z.boolean().optional(),
  resetCursor: z.boolean().optional(),
});

export async function updateFeed(actor: Actor | null, id: string, input: unknown) {
  assertOwner(actor);
  const body = updateFeedSchema.parse(input);
  const feed = await OpportunityFeed.findById(parseObjectId(id)).lean<OpportunityFeedDoc>();
  if (!feed) throw Errors.notFound();
  const provider = getOpportunityProvider(feed.providerId);
  if (!provider) throw Errors.notFound();
  const set: Record<string, unknown> = {};
  if (body.enabled !== undefined) {
    if (body.enabled && provider.requiresAgreement && !body.acknowledgeTerms) throw Errors.badRequest("Confirm that your use complies with the provider's terms (an agreement is required for commercial use).");
    set.enabled = body.enabled;
    if (body.enabled) set.nextRunAt = new Date();
  }
  if (body.intervalMinutes) set.intervalMinutes = body.intervalMinutes;
  if (body.settings) {
    const allowed = new Set((provider.settingFields ?? []).map((s) => s.key));
    for (const [k, v] of Object.entries(body.settings)) if (allowed.has(k)) set[`settings.${k}`] = v;
  }
  if (body.resetCursor) Object.assign(set, { cursor: null, nextRunAt: new Date() });
  await OpportunityFeed.updateOne({ _id: feed._id }, { $set: set });
  await audit(actor, "opportunity.feed_updated", { entityType: "OpportunityFeed", entityId: String(feed._id), metadata: { keys: Object.keys(set) } });
  return { ok: true };
}

/** Removes an employer feed. Its stored opportunities and evidence are kept (history), not deleted. */
export async function deleteEmployerFeed(actor: Actor | null, id: string) {
  assertOwner(actor);
  const feed = await OpportunityFeed.findById(parseObjectId(id)).lean<OpportunityFeedDoc>();
  if (!feed) throw Errors.notFound();
  if (feed.kind !== "EMPLOYER") throw Errors.badRequest("Provider feeds can be disabled, not deleted.");
  await OpportunityFeed.deleteOne({ _id: feed._id });
  await audit(actor, "opportunity.feed_deleted", { entityType: "OpportunityFeed", entityId: String(feed._id) });
  return { ok: true };
}

export async function triggerFeedSync(actor: Actor | null, id: string) {
  assertOwner(actor);
  const feed = await OpportunityFeed.findById(parseObjectId(id)).lean<OpportunityFeedDoc>();
  if (!feed) throw Errors.notFound();
  const provider = getOpportunityProvider(feed.providerId);
  const cfg = provider?.isConfigured();
  if (cfg && !cfg.ok) throw Errors.badRequest(cfg.message ?? `Missing configuration: ${cfg.missing.join(", ")}`);
  await enqueueFeedSync(String(feed._id), actor.id);
  return { queued: true };
}

export async function reverifyFeed(actor: Actor | null, id: string) {
  assertOwner(actor);
  const v = await verifyEmployerFeed(parseObjectId(id));
  if (!v) throw Errors.notFound();
  return v;
}

export async function listSyncRuns(actor: Actor | null, opts: { feedId?: string; limit?: number; failedOnly?: boolean } = {}) {
  assertOwner(actor);
  return OpportunitySyncRun.find({ ...(opts.feedId && { feedId: parseObjectId(opts.feedId) }), ...(opts.failedOnly && { status: "FAILED" }) })
    .sort({ startedAt: -1 })
    .limit(Math.min(opts.limit ?? 100, 500))
    .lean<OpportunitySyncRunDoc[]>();
}

export type CountryTypeCoverage = {
  type: OpportunityType;
  support: CountrySupport;
  providers: { id: string; name: string; level: CoverageLevel; note: string; state: ProviderState; lastSuccessAt?: Date | null; lastError?: string | null; intervalMinutes: number; removalDetection: string; activityCheck: boolean; employerIdentity: string }[];
  employerFeeds: number;
  candidates: { name: string; status: string; reason: string }[];
  open: number;
};

export type CountryCoverageRow = { code: string; name: string; flag: string; timezone: string; hiringNotes: string; procurementNotes: string; types: CountryTypeCoverage[] };

/** Country × opportunity type matrix computed from provider declarations + live feed health. */
export async function getCountryCoverage(actor: Actor | null): Promise<CountryCoverageRow[]> {
  assertOwner(actor);
  const { feeds, providers } = await listFeeds(actor);
  const openAgg = await Opportunity.aggregate<{ _id: { c: string; t: OpportunityType }; n: number }>([
    { $match: { isCanonical: true, archivedAt: null, activity: { $in: ["ACTIVE", "UNKNOWN"] } } },
    { $group: { _id: { c: "$countryCode", t: "$type" }, n: { $sum: 1 } } },
  ]);
  const employerByCountry = await Opportunity.aggregate<{ _id: { c: string; t: OpportunityType; f: Types.ObjectId } }>([{ $match: { isCanonical: true, archivedAt: null, sourceClass: { $in: ["OFFICIAL_EMPLOYER_ATS", "OFFICIAL_EMPLOYER_SOURCE"] } } }, { $group: { _id: { c: "$countryCode", t: "$type", f: "$feedId" } } }]);
  return OPPORTUNITY_COUNTRIES.map((c) => ({
    code: c.code,
    name: c.name,
    flag: c.flag,
    timezone: c.timezone,
    hiringNotes: c.hiringNotes,
    procurementNotes: c.procurementNotes,
    types: OPPORTUNITY_TYPES.map((type): CountryTypeCoverage => {
      const rows = providers
        .filter((p) => p.type === type && !p.perEmployer)
        .flatMap((p) => p.coverage.filter((cv) => cv.code === c.code).map((cv) => ({ p, cv })))
        .map(({ p, cv }) => {
          const f = feeds.find((x) => x.providerId === p.id && x.kind === "PROVIDER");
          return {
            id: p.id,
            name: p.name,
            level: cv.level,
            note: cv.note,
            state: f?.state ?? (p.configured.ok ? "DISABLED" : "NEEDS_CREDENTIALS"),
            lastSuccessAt: f?.health?.lastSuccessAt ?? null,
            lastError: f?.health?.lastError ?? null,
            intervalMinutes: f?.intervalMinutes ?? p.recommendedIntervalMinutes,
            removalDetection: p.capabilities.removalDetection,
            activityCheck: p.hasActivityCheck,
            employerIdentity: p.capabilities.employerIdentity,
          };
        });
      const employerFeeds = new Set(employerByCountry.filter((e) => e._id.c === c.code && e._id.t === type).map((e) => String(e._id.f))).size;
      const operational = rows.filter((r) => r.state === "OPERATIONAL");
      const support: CountrySupport = operational.some((r) => r.level === "NATIONAL_OFFICIAL") ? "FULLY_OPERATIONAL" : operational.length || employerFeeds ? "PARTIALLY_OPERATIONAL" : "NOT_CONFIGURED";
      return {
        type,
        support,
        providers: rows,
        employerFeeds,
        candidates: CANDIDATE_SOURCES.filter((s) => s.type === type && s.countries.includes(c.code)).map((s) => ({ name: s.name, status: s.status, reason: s.reason })),
        open: openAgg.find((o) => o._id.c === c.code && o._id.t === type)?.n ?? 0,
      };
    }),
  }));
}

/** Lightweight counts for the sidebar (owner only). */
export async function opportunityNavCounts(actor: Actor | null) {
  assertOwner(actor);
  const [review, saved] = await Promise.all([Opportunity.countDocuments({ isCanonical: true, archivedAt: null, labels: "NEEDS_MANUAL_REVIEW" }), Opportunity.countDocuments({ isCanonical: true, saved: true })]);
  return { review, saved };
}

/** Owner-linked company search for employer feeds (exact registration number or name prefix, owner only). */
export async function searchCompaniesForLink(actor: Actor | null, query: string) {
  assertOwner(actor);
  const q = query.trim();
  if (q.length < 2) return [];
  const rows = await Company.find({ isDemo: { $ne: true }, $or: [{ registrationNumber: q }, { companyName: new RegExp(`^${escapeRe(q)}`, "i") }] })
    .select("companyName registrationNumber countryCode")
    .limit(10)
    .lean<CompanyDoc[]>();
  return rows.map((r) => ({ id: String(r._id), name: r.companyName, registrationNumber: r.registrationNumber, countryCode: r.countryCode }));
}
