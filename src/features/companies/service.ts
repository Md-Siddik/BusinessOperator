import "server-only";
import { Types, type FilterQuery } from "mongoose";
import { z } from "zod";
import { COUNTRIES, COUNTRY_CODES, getCountry } from "@/config/countries";
import { INDUSTRIES } from "@/config/industries";
import { LEAD_STAGES, stagesFrom, type LeadStage } from "@/lib/constants";
import { CONTACT_FILTERS, CONTACT_STATUSES, ELIGIBILITY_STATES, PENDING_RESEARCH_STATUSES, RELEVANCE_VALUES, RESEARCH_STATUSES, contactQuality, contactStatusFilter, type ContactFilter } from "@/lib/company-fields";
import { COMPANY_TYPE_PARAMS, INACTIVE_STATUS, type CompanyTypeParam } from "@/lib/company-classification";
import { companyVisibilityFilter } from "@/lib/data-mode";
import { DATE_PRESETS, isDay, localRangeUtc, resolveDayRange, type DayRange } from "@/lib/dates/country-time";
import {
  Company,
  Contact,
  CrmActivity,
  EmailMessage,
  FollowUp,
  SuppressionEntry,
  User,
  WebsiteAudit,
  type CompanyDoc,
  type ContactDoc,
  type CrmActivityDoc,
  type EmailMessageDoc,
  type FollowUpDoc,
  type WebsiteAuditDoc,
} from "@/models";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { can, isInternal, isTeamMember, type Actor } from "@/lib/permissions";
import { escapeRegex } from "@/lib/utils";
import { optionalPhone, optionalUrl, paginate, parseObjectId } from "@/lib/validation";
import { getSetting } from "@/features/settings/service";
import { scoreCompany } from "./scoring";

export const ALL = "ALL";

/** Throws unless the actor may read company intelligence (Owner, or a team member granted it). Clients never can. */
export function assertCanReadCompanies(actor: Actor | null) {
  if (!actor || !isTeamMember(actor) || !can(actor, "companies.read")) throw Errors.forbidden();
}

/** Company Type filter. Unclassified records count as Needs Review (never guessed into a category). */
export function companyTypeFilter(t: CompanyTypeParam): FilterQuery<CompanyDoc> {
  const value = COMPANY_TYPE_PARAMS[t];
  return value === "NEEDS_REVIEW" ? { "companyType.value": { $nin: ["STARTUP", "ESTABLISHED"] } } : { "companyType.value": value };
}

export const OLD_COMPANY_MONTHS = 6;

/**
 * Old company Intelligence. "old": registered at least 6 months before `now` (incorporation date
 * when published, otherwise the registry's registration date) AND a published registry status that
 * is not closed / dissolved / inactive — an old date alone never counts as operating.
 * "unverified": records that can't be verified yet (no status, or no date at all) and aren't
 * known to be closed; kept visible separately, never presented as verified.
 */
export function oldCompanyFilter(age: "old" | "unverified", now = new Date()): FilterQuery<CompanyDoc> {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - OLD_COMPANY_MONTHS);
  const registeredBefore = { $or: [{ incorporationDate: { $lte: cutoff } }, { incorporationDate: null, registrationDate: { $lte: cutoff } }] };
  if (age === "old") return { $and: [registeredBefore, { status: { $nin: [null, ""], $not: INACTIVE_STATUS } }] };
  const noDate = { incorporationDate: null, registrationDate: null, status: { $not: INACTIVE_STATUS } };
  return { $or: [{ $and: [registeredBefore, { status: { $in: [null, ""] } }] }, noDate] };
}

/** Resolve a country query value to a DB filter. "ALL" must be explicit — there is no implicit mixed feed. */
export function countryFilter(country: string | undefined | null): { countryCode?: string } {
  const code = (country ?? "").toUpperCase();
  if (code === ALL) return {};
  if (!COUNTRY_CODES.includes(code)) throw Errors.badRequest("A valid country is required (or ALL).");
  return { countryCode: code };
}

/**
 * Registration-day filter in each country's own timezone. For ALL, every
 * country gets its own "today" (Oslo and London can be on different days).
 * Uses the registry's registrationDay — never createdAt.
 */
export function registrationDayFilter(country: string, preset: string | undefined, from?: string, to?: string, now = new Date(), view: CompanyView = "registered"): FilterQuery<CompanyDoc> {
  const codes = country.toUpperCase() === ALL ? COUNTRY_CODES : [country.toUpperCase()];
  const parts = codes.map((code) => {
    const tz = getCountry(code)!.timezone;
    const r = resolveDayRange(tz, preset, from, to, now);
    if (!r.from || !r.to) return { countryCode: code };
    if (view === "registered") return { countryCode: code, registrationDay: { $gte: r.from, $lte: r.to } };
    // "First received" and "Contacts found" are timestamps — bounded by the country's local days.
    const { start, end } = localRangeUtc(r.from, r.to, tz);
    return { countryCode: code, [view === "received" ? "firstSeenAt" : "contactFoundAt"]: { $gte: start, $lt: end } };
  });
  if (parts.length === 1) return parts[0]!;
  if (parts.every((p) => Object.keys(p).length === 1)) return {};
  return { $or: parts };
}

/**
 * Three distinct daily views:
 *  registered — the registry's own registration date (never createdAt / firstSeenAt)
 *  received   — first stored by ExploreTechify in that period (any registration date)
 *  contacts   — first usable direct contact found in that period (any registration date)
 */
export const COMPANY_VIEWS = ["registered", "received", "contacts"] as const;
export type CompanyView = (typeof COMPANY_VIEWS)[number];
export const COMPANY_VIEW_LABELS: Record<CompanyView, string> = { registered: "Registered", received: "First received", contacts: "Contacts found" };

const yesNo = z.enum(["yes", "no"]).optional();
const MILESTONES = ["qualified", "contacted", "replied", "meeting", "proposal", "client"] as const;
const MILESTONE_STAGE: Record<(typeof MILESTONES)[number], LeadStage> = {
  qualified: "QUALIFIED",
  contacted: "CONTACTED",
  replied: "REPLIED",
  meeting: "MEETING",
  proposal: "PROPOSAL",
  client: "CLIENT",
};
export const NOT_CONTACTED_STAGES: LeadStage[] = ["NEW", "RESEARCHING", "CONTACT_AVAILABLE", "QUALIFIED", "QUOTATION_DRAFTED", "READY_FOR_OUTREACH"];

/** Secondary orderings — the direct-contact group always comes first. */
export const COMPANY_SORTS = ["contact", "registration", "fit", "completeness", "score", "industry", "name", "email", "phone", "type", "updated"] as const;
export type CompanySort = (typeof COMPANY_SORTS)[number];
export const COMPANY_SORT_LABELS: Record<CompanySort, string> = {
  contact: "Contact quality, fit, newest (default)",
  registration: "Registration date (newest)",
  fit: "Service fit",
  completeness: "Contact completeness",
  score: "Lead score",
  industry: "Industry",
  name: "Company name",
  email: "Email first",
  phone: "Phone first",
  type: "Company type",
  updated: "Last updated",
};

const day = z.string().refine(isDay, "Use YYYY-MM-DD").optional();

export const companyQuerySchema = z.object({
  country: z.string().min(2),
  range: z.enum(DATE_PRESETS).default("all"),
  from: day,
  to: day,
  q: z.string().trim().max(120).optional(),
  industry: z.enum(INDUSTRIES).optional(),
  industryCode: z.string().trim().max(20).optional(),
  legalForm: z.string().max(80).optional(),
  status: z.string().max(60).optional(),
  contact: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter((x): x is ContactFilter => (CONTACT_FILTERS as readonly string[]).includes(x)) : [])),
  minCompleteness: z.coerce.number().int().min(0).max(100).optional(),
  website: yesNo,
  email: yesNo,
  phone: yesNo,
  hiring: yesNo,
  opportunity: yesNo,
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  maxScore: z.coerce.number().int().min(0).max(100).optional(),
  relevance: z.enum([...RELEVANCE_VALUES, "UNREVIEWED"]).optional(),
  qualified: yesNo,
  notContacted: yesNo,
  saved: yesNo,
  stage: z.enum(LEAD_STAGES).optional(),
  milestone: z.enum(MILESTONES).optional(),
  assigned: z.string().max(40).optional(),
  leadsOnly: z.coerce.boolean().optional(),
  sort: z
    .enum([...COMPANY_SORTS, "recent"])
    .default("contact")
    .transform((s) => (s === "recent" ? "registration" : s) as CompanySort),
  view: z.enum(COMPANY_VIEWS).default("registered"),
  /** Include non-new events (branches, continuations, ambiguous) — excluded from new-company lists by default. */
  events: z.enum(["new", "all", "review"]).default("new"),
  fit: yesNo,
  followUpDue: yesNo,
  eligibility: z.enum(ELIGIBILITY_STATES).optional(),
  research: z.enum(RESEARCH_STATUSES).optional(),
  /** Company Type (shared classification): startup | established | review. */
  type: z.enum(Object.keys(COMPANY_TYPE_PARAMS) as [CompanyTypeParam, ...CompanyTypeParam[]]).optional(),
  contactStatus: z.enum(CONTACT_STATUSES).optional(),
  /** Old company Intelligence: "old" = verified operating companies registered ≥ 6 months ago; "unverified" = their records still missing a status or date. */
  age: z.enum(["old", "unverified"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(200).default(50),
});
export type CompanyQuery = z.infer<typeof companyQuerySchema>;

const present = (field: string) => ({ [field]: { $exists: true, $nin: [null, ""] } });
const absent = (field: string) => ({ $or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: "" }] });

export function buildCompanyFilter(actor: Actor, q: CompanyQuery, now = new Date()): FilterQuery<CompanyDoc> {
  const and: FilterQuery<CompanyDoc>[] = [countryFilter(q.country), companyVisibilityFilter()];
  const dayFilter = registrationDayFilter(q.country, q.range, q.from, q.to, now, q.view);
  if (Object.keys(dayFilter).length) and.push(dayFilter);
  if (q.events === "new") and.push({ $or: [{ eventType: "NEW_ENTITY" }, { eventType: { $exists: false } }, { eventType: null }] });
  else if (q.events === "review") and.push({ eventType: { $nin: ["NEW_ENTITY", null] } });
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    const digits = q.q.replace(/[\s.-]/g, "");
    and.push({
      $or: [
        { companyName: rx },
        { registrationNumber: /^[\dA-Z-]+$/i.test(digits) ? new RegExp(`^${escapeRegex(digits)}`, "i") : rx },
        { email: rx },
        { website: rx },
        { phone: rx },
        { mobile: rx },
        { address: rx },
        { city: rx },
        { "contactPerson.name": rx },
      ],
    });
  }
  if (q.industry) and.push({ industry: q.industry });
  if (q.industryCode) and.push({ $or: [{ industryCode: new RegExp(`^${escapeRegex(q.industryCode)}`) }, { naceCode: new RegExp(`^${escapeRegex(q.industryCode)}`) }] });
  if (q.legalForm) and.push({ legalForm: q.legalForm });
  if (q.status) and.push({ status: q.status });
  for (const f of q.contact) {
    if (f === "email") and.push({ "directContact.hasEmail": true });
    if (f === "phone") and.push({ "directContact.hasPhone": true });
    if (f === "website") and.push({ "contactFlags.website": true });
    if (f === "person") and.push({ "contactFlags.person": true });
    if (f === "complete") and.push({ fullyContactable: true });
    if (f === "none") and.push({ "contactFlags.email": { $ne: true }, "contactFlags.phone": { $ne: true }, "contactFlags.mobile": { $ne: true }, "contactFlags.website": { $ne: true } });
    if (f === "both") and.push({ "directContact.hasEmail": true, "directContact.hasPhone": true });
    if (f === "direct") and.push({ "directContact.has": true });
    if (f === "form") and.push({ "directContact.formOnly": true });
    if (f === "nodirect") and.push({ "directContact.has": { $ne: true } });
    if (f === "pending") and.push({ $or: [{ "directContact.pendingVerification": true }, { "research.status": "VERIFICATION_PENDING" }] });
    // Verified = deliverability-checked email or reachability-confirmed phone (never "published" alone).
    if (f === "verified") and.push({ $or: [{ "directContact.emailVerification": "DELIVERABLE" }, { "directContact.phoneVerification": "REACHABILITY_CONFIRMED" }] });
    if (f === "researching") and.push({ "directContact.has": { $ne: true }, $or: [{ "research.status": { $in: PENDING_RESEARCH_STATUSES } }, { "research.status": { $exists: false } }] });
  }
  if (q.fit === "yes") and.push({ "serviceFit.score": { $gte: 50 } });
  if (q.followUpDue === "yes") and.push({ "lead.nextFollowUpAt": { $lte: now } });
  if (q.eligibility) and.push(q.eligibility === "NEEDS_REVIEW" ? { $or: [{ "eligibility.status": "NEEDS_REVIEW" }, { "eligibility.status": { $exists: false } }] } : { "eligibility.status": q.eligibility });
  if (q.research) and.push({ "research.status": q.research });
  if (q.type) and.push(companyTypeFilter(q.type));
  if (q.age) and.push(oldCompanyFilter(q.age, now));
  if (q.contactStatus) and.push(contactStatusFilter(q.contactStatus) as FilterQuery<CompanyDoc>);
  if (q.minCompleteness !== undefined) and.push({ completeness: { $gte: q.minCompleteness } });
  for (const field of ["website", "email", "phone"] as const) {
    if (q[field] === "yes") and.push(present(field));
    if (q[field] === "no") and.push(absent(field));
  }
  if (q.hiring === "yes") and.push({ "signals.hiring": true });
  if (q.hiring === "no") and.push({ "signals.hiring": { $ne: true } });
  if (q.opportunity) and.push({ digitalOpportunity: q.opportunity === "yes" });
  if (q.minScore !== undefined || q.maxScore !== undefined) {
    and.push({ "lead.score": { ...(q.minScore !== undefined && { $gte: q.minScore }), ...(q.maxScore !== undefined && { $lte: q.maxScore }) } });
  }
  if (q.relevance === "UNREVIEWED") and.push({ $or: [{ "lead.relevance": { $exists: false } }, { "lead.relevance": null }] });
  else if (q.relevance) and.push({ "lead.relevance": q.relevance });
  if (q.qualified === "yes") and.push({ "lead.stage": { $in: stagesFrom("QUALIFIED") } });
  if (q.notContacted === "yes") and.push({ "lead.stage": { $in: NOT_CONTACTED_STAGES } });
  if (q.saved === "yes") and.push({ "lead.saved": true });
  if (q.stage) and.push({ "lead.stage": q.stage });
  if (q.milestone) and.push({ "lead.stage": { $in: stagesFrom(MILESTONE_STAGE[q.milestone]) } });
  if (q.leadsOnly) and.push({ "lead.stage": { $nin: ["NEW"] } });
  if (q.assigned === "me") and.push({ "lead.assignedTo": new Types.ObjectId(actor.id) });
  else if (q.assigned === "unassigned") and.push({ "lead.assignedTo": null });
  else if (q.assigned && Types.ObjectId.isValid(q.assigned)) and.push({ "lead.assignedTo": new Types.ObjectId(q.assigned) });
  const parts = and.filter((x) => Object.keys(x).length);
  return parts.length === 0 ? {} : parts.length === 1 ? parts[0]! : { $and: parts };
}

/**
 * Contact-first ordering, applied in the database to the complete filtered set
 * BEFORE pagination (Today, country pages, All Countries, search, exports).
 * Companies with a usable direct email or phone always come first; the chosen
 * sort only orders within the two groups. _id makes the order stable.
 */
export function sortFor(sort: CompanySort): Record<string, 1 | -1> {
  const first = { "directContact.has": -1 } as const;
  switch (sort) {
    case "type":
      return { ...first, "companyType.value": -1, "directContact.quality": -1, _id: 1 };
    case "updated":
      return { ...first, updatedAt: -1, _id: 1 };
    case "registration":
      return { ...first, registrationDay: -1, _id: 1 };
    case "fit":
      return { ...first, "serviceFit.score": -1, "directContact.quality": -1, registrationDay: -1, _id: 1 };
    case "completeness":
      return { ...first, completeness: -1, registrationDay: -1, _id: 1 };
    case "score":
      return { ...first, "lead.score": -1, registrationDay: -1, _id: 1 };
    case "industry":
      return { ...first, industry: 1, industryCode: 1, _id: 1 };
    case "name":
      return { ...first, companyName: 1, _id: 1 };
    case "email":
      return { ...first, "directContact.hasEmail": -1, "directContact.quality": -1, registrationDay: -1, _id: 1 };
    case "phone":
      return { ...first, "directContact.hasPhone": -1, "directContact.quality": -1, registrationDay: -1, _id: 1 };
    default:
      return { ...first, "directContact.quality": -1, "serviceFit.score": -1, registrationDay: -1, _id: 1 };
  }
}

/** Fields shown in the daily table and drawer. Never includes sourceData. */
export const LIST_FIELDS =
  "companyName registrationNumber countryCode countryName registrationDay registrationDateType eventType firstSeenAt contactFoundAt legalForm status industry industryCode industryDescription industryCodeSystem businessActivity address city region postalCode email phone mobile website contactFormUrl contactPerson contactSources contactFlags directContact completeness fullyContactable marketingProtected research.status research.nextRetryAt research.attempts eligibility serviceFit.score serviceFit.suggestions lead.stage lead.score lead.relevance lead.saved lead.assignedTo lead.nextFollowUpAt lead.lastContactedAt signals.hiring digitalOpportunity isDemo source sourceName sourceType dataFreshness sourceFetchedAt sourcePublishedAt sourceUrl companyType.value companyType.reason companyType.manual employees incorporationDate discoveredVia contactLastVerifiedAt updatedAt";

export async function listCompanies(actor: Actor, input: unknown) {
  assertCanReadCompanies(actor);
  const q = companyQuerySchema.parse(input);
  const filter = buildCompanyFilter(actor, q);
  const [items, total] = await Promise.all([
    Company.find(filter).select(LIST_FIELDS).sort(sortFor(q.sort)).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean<CompanyDoc[]>(),
    Company.countDocuments(filter),
  ]);
  return paginate(items, total, q.page, q.pageSize);
}

/** Counts per Company Type for the category tabs (same filters, ignoring the type itself). */
export async function countByCompanyType(actor: Actor, input: unknown) {
  assertCanReadCompanies(actor);
  const q = companyQuerySchema.parse(input);
  const filter = buildCompanyFilter(actor, { ...q, type: undefined });
  const rows = await Company.aggregate<{ _id: string | null; n: number }>([{ $match: filter }, { $group: { _id: "$companyType.value", n: { $sum: 1 } } }]);
  const out = { all: 0, startup: 0, established: 0, review: 0 };
  for (const r of rows) {
    out.all += r.n;
    if (r._id === "STARTUP") out.startup += r.n;
    else if (r._id === "ESTABLISHED") out.established += r.n;
    else out.review += r.n;
  }
  return out;
}

/** Previous / next company in the same country and registration day (for reviewing a day's list one by one). */
export async function getNeighbors(company: Pick<CompanyDoc, "_id" | "countryCode" | "registrationDay" | "companyName">) {
  if (!company.registrationDay) return { prev: null, next: null, position: null, total: null };
  const base = { countryCode: company.countryCode, registrationDay: company.registrationDay, ...companyVisibilityFilter() };
  const before = { $or: [{ companyName: { $lt: company.companyName } }, { companyName: company.companyName, _id: { $lt: company._id } }] };
  const after = { $or: [{ companyName: { $gt: company.companyName } }, { companyName: company.companyName, _id: { $gt: company._id } }] };
  const [prev, next, position, total] = await Promise.all([
    Company.findOne({ ...base, ...before }).sort({ companyName: -1, _id: -1 }).select("_id companyName").lean<{ _id: Types.ObjectId; companyName: string }>(),
    Company.findOne({ ...base, ...after }).sort({ companyName: 1, _id: 1 }).select("_id companyName").lean<{ _id: Types.ObjectId; companyName: string }>(),
    Company.countDocuments({ ...base, ...before }),
    Company.countDocuments(base),
  ]);
  return {
    prev: prev ? { id: String(prev._id), name: prev.companyName } : null,
    next: next ? { id: String(next._id), name: next.companyName } : null,
    position: position + 1,
    total,
  };
}

export async function getCompanyDetail(actor: Actor, id: string) {
  assertCanReadCompanies(actor);
  const company = await Company.findOne({ _id: parseObjectId(id), ...companyVisibilityFilter() }).lean<CompanyDoc>();
  if (!company) throw Errors.notFound();
  const [contacts, activities, followUps, emails, audits, assignee, neighbors] = await Promise.all([
    Contact.find({ companyId: company._id }).sort({ type: 1, createdAt: 1 }).lean<ContactDoc[]>(),
    CrmActivity.find({ companyId: company._id }).sort({ createdAt: -1 }).limit(50).populate("actorId", "name").lean<(CrmActivityDoc & { actorId?: { name: string } })[]>(),
    FollowUp.find({ companyId: company._id }).sort({ status: -1, dueAt: 1 }).limit(30).populate("assignedTo", "name").lean<(FollowUpDoc & { assignedTo?: { _id: Types.ObjectId; name: string } })[]>(),
    EmailMessage.find({ companyId: company._id, kind: "OUTREACH" }).sort({ createdAt: -1 }).limit(20).lean<EmailMessageDoc[]>(),
    WebsiteAudit.find({ companyId: company._id }).sort({ checkedAt: -1 }).limit(1).lean<WebsiteAuditDoc[]>(),
    company.lead?.assignedTo ? User.findById(company.lead.assignedTo).select("name email").lean<{ name: string; email: string }>() : null,
    getNeighbors(company),
  ]);
  return {
    company,
    contacts,
    activities,
    followUps,
    emails,
    latestAudit: audits[0] ?? null,
    assignee,
    neighbors,
    canManage: canManageLead(actor, company),
    canEdit: can(actor, "companies.edit"),
    canResearch: can(actor, "companies.edit") || can(actor, "leads.manage"),
  };
}

/** Raw provider record — for administrators debugging normalization only. */
export async function getCompanySourceData(actor: Actor, id: string) {
  if (!can(actor, "settings.manage")) throw Errors.forbidden();
  const company = await Company.findById(parseObjectId(id)).select("+sourceData source sourceId sourceFetchedAt").lean<{ sourceData?: unknown; source: string; sourceId: string; sourceFetchedAt?: Date }>();
  if (!company) throw Errors.notFound();
  return company;
}

/** Staff may manage only leads assigned to them unless they hold leads.manage. */
export function canManageLead(actor: Actor, company: Pick<CompanyDoc, "lead">) {
  if (can(actor, "leads.manage")) return true;
  return isInternal(actor) && !!company.lead?.assignedTo && String(company.lead.assignedTo) === actor.id;
}

export const updateCompanySchema = z.object({
  website: optionalUrl,
  email: z.union([z.email(), z.literal("")]).optional().transform((v) => v || undefined),
  phone: optionalPhone,
  mobile: optionalPhone,
  contactPersonName: z.string().trim().max(120).optional(),
  contactPersonRole: z.string().trim().max(120).optional(),
  socialLinks: z.array(z.object({ network: z.string().max(30), url: z.url() })).max(10).optional(),
});

/** Manual contact corrections. Values are recorded with source "Added manually" and never overwritten by registry syncs. */
export async function updateCompany(actor: Actor, id: string, input: unknown) {
  if (!can(actor, "companies.edit")) throw Errors.forbidden();
  const data = updateCompanySchema.parse(input);
  const company = await Company.findById(parseObjectId(id)).lean<CompanyDoc>();
  if (!company) throw Errors.notFound();
  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  const now = new Date();
  const manual = { kind: "MANUAL", source: `Added by ${actor.name}`, at: now };
  for (const key of ["website", "email", "phone", "mobile"] as const) {
    if (!(key in data)) continue;
    const v = data[key];
    if (v) {
      set[key] = v;
      set[`contactSources.${key}`] = manual;
      await Contact.updateOne(
        { companyId: company._id, type: key.toUpperCase(), value: v },
        { $set: { sourceKind: "MANUAL", source: manual.source, countryCode: company.countryCode }, $setOnInsert: { companyId: company._id, type: key.toUpperCase(), value: v } },
        { upsert: true },
      );
    } else {
      unset[key] = 1;
      unset[`contactSources.${key}`] = 1;
    }
  }
  if (data.contactPersonName !== undefined) {
    if (data.contactPersonName) {
      set.contactPerson = { name: data.contactPersonName, role: data.contactPersonRole || "Contact person" };
      set["contactSources.contactPerson"] = manual;
    } else {
      unset.contactPerson = 1;
      unset["contactSources.contactPerson"] = 1;
    }
  }
  if (data.socialLinks) set.socialLinks = data.socialLinks;
  const merged = { ...company, ...set } as CompanyDoc;
  for (const k of Object.keys(unset)) delete (merged as Record<string, unknown>)[k];
  const quality = contactQuality({ ...merged, address: merged.address ?? merged.city });
  Object.assign(set, { contactFlags: quality.flags, completeness: quality.completeness, fullyContactable: quality.fullyContactable });
  const updated = await Company.findByIdAndUpdate(company._id, { $set: set, ...(Object.keys(unset).length && { $unset: unset }) }, { new: true }).lean<CompanyDoc>();
  await rescoreCompanies({ _id: company._id });
  await audit(actor, "company.updated", { entityType: "Company", entityId: id, countryCode: company.countryCode, metadata: { fields: Object.keys(data) } });
  return updated;
}

const qualifySchema = z.object({
  relevance: z.enum([...RELEVANCE_VALUES, "CLEAR"]).optional(),
  saved: z.boolean().optional(),
});

/**
 * Quick research decisions from the daily list: Relevant / Maybe / Not relevant
 * and "save as lead". Any internal user who can read companies may record these;
 * pipeline stage changes go through the CRM rules.
 */
export async function qualifyCompany(actor: Actor, id: string, input: unknown) {
  assertCanReadCompanies(actor);
  const data = qualifySchema.parse(input);
  const company = await Company.findOne({ _id: parseObjectId(id), ...companyVisibilityFilter() }).select("countryCode lead").lean<CompanyDoc>();
  if (!company) throw Errors.notFound();
  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  if (data.relevance === "CLEAR") {
    unset["lead.relevance"] = 1;
    unset["lead.relevanceAt"] = 1;
  } else if (data.relevance) {
    set["lead.relevance"] = data.relevance;
    set["lead.relevanceAt"] = new Date();
    set["lead.relevanceBy"] = new Types.ObjectId(actor.id);
  }
  if (data.saved !== undefined) {
    set["lead.saved"] = data.saved;
    set["lead.savedAt"] = data.saved ? new Date() : undefined;
  }
  await Company.updateOne({ _id: company._id }, { $set: set, ...(Object.keys(unset).length && { $unset: unset }) });
  const note = [data.relevance && data.relevance !== "CLEAR" ? `Marked ${data.relevance.replace("_", " ").toLowerCase()}` : data.relevance === "CLEAR" ? "Cleared relevance" : null, data.saved === true ? "Saved as lead" : data.saved === false ? "Removed from saved leads" : null]
    .filter(Boolean)
    .join(" · ");
  if (note) await CrmActivity.create({ companyId: company._id, countryCode: company.countryCode, type: "SYSTEM", body: note, actorId: actor.id });
  await audit(actor, "company.qualified", { entityType: "Company", entityId: id, countryCode: company.countryCode, metadata: data });
  return { ok: true };
}

/**
 * Delete a company and its personal/contact data (data-subject request or
 * data minimisation). Optionally suppress its addresses so re-imports are never contacted.
 */
export async function deleteCompany(actor: Actor, id: string, opts: { suppress?: boolean } = {}) {
  if (!can(actor, "companies.delete")) throw Errors.forbidden();
  const company = await Company.findById(parseObjectId(id)).lean<CompanyDoc>();
  if (!company) throw Errors.notFound();
  const contacts = await Contact.find({ companyId: company._id, type: "EMAIL" }).select("value").lean<{ value: string }[]>();
  if (opts.suppress) {
    const emails = [...new Set([company.email, ...contacts.map((c) => c.value)].filter(Boolean) as string[])];
    for (const email of emails) {
      await SuppressionEntry.updateOne({ email }, { $setOnInsert: { email, reason: "DO_NOT_CONTACT", source: "company-deletion", createdBy: actor.id } }, { upsert: true });
    }
  }
  await Promise.all([
    Contact.deleteMany({ companyId: company._id }),
    CrmActivity.deleteMany({ companyId: company._id }),
    FollowUp.deleteMany({ companyId: company._id }),
    WebsiteAudit.deleteMany({ companyId: company._id }),
    EmailMessage.updateMany({ companyId: company._id }, { $unset: { companyId: 1, personalization: 1 } }),
    Company.deleteOne({ _id: company._id }),
  ]);
  await audit(actor, "company.deleted", { entityType: "Company", entityId: id, countryCode: company.countryCode, metadata: { suppressed: !!opts.suppress } });
}

/**
 * Recompute transparent lead scores. Scoring never changes the pipeline
 * stage — qualification is a human decision on the daily list.
 */
export async function rescoreCompanies(filter: FilterQuery<CompanyDoc>) {
  const settings = await getSetting("leadScoring");
  const now = new Date();
  let processed = 0;
  let aboveThreshold = 0;
  const cursor = Company.find(filter).select("registrationDate industry website email phone mobile legalForm socialLinks signals auditSummary").lean<CompanyDoc[]>().cursor();
  let batch: Parameters<typeof Company.bulkWrite>[0] = [];
  for await (const c of cursor) {
    const result = scoreCompany({ ...c, phone: c.phone ?? c.mobile }, settings, now);
    if (result.qualified) aboveThreshold++;
    batch.push({
      updateOne: {
        filter: { _id: c._id },
        update: { $set: { "lead.score": result.score, "lead.scoreBreakdown": result.breakdown, "lead.scoredAt": now, digitalOpportunity: result.digitalOpportunity } },
      },
    });
    processed++;
    if (batch.length >= 500) {
      await Company.bulkWrite(batch, { ordered: false });
      batch = [];
    }
  }
  if (batch.length) await Company.bulkWrite(batch, { ordered: false });
  return { processed, aboveThreshold };
}

/** Global search across name, registration number, email, phone, website and address. */
export async function searchCompanies(actor: Actor, raw: string) {
  assertCanReadCompanies(actor);
  const q = raw.trim().slice(0, 120);
  if (q.length < 2) return [];
  const rx = new RegExp(escapeRegex(q), "i");
  const compact = q.replace(/[\s.-]/g, "");
  const or: FilterQuery<CompanyDoc>[] = [{ companyName: rx }, { email: rx }, { website: rx }, { address: rx }, { city: rx }];
  if (/^[\dA-Z]{3,}$/i.test(compact)) or.push({ registrationNumber: new RegExp(`^${escapeRegex(compact)}`, "i") });
  if (/^\+?\d{4,}$/.test(compact)) or.push({ phone: new RegExp(escapeRegex(compact.replace(/^\+/, ""))) }, { mobile: new RegExp(escapeRegex(compact.replace(/^\+/, ""))) });
  return Company.find({ $or: or, ...companyVisibilityFilter() })
    .select("companyName registrationNumber countryCode registrationDay city email phone website isDemo")
    .sort({ registrationDay: -1 })
    .limit(20)
    .lean<CompanyDoc[]>();
}

/** All enabled country filters for DayRange display (used by pages). */
export function rangeFor(country: string, preset?: string, from?: string, to?: string): DayRange {
  const code = country.toUpperCase();
  const tz = getCountry(code)?.timezone ?? COUNTRIES[0]!.timezone;
  return resolveDayRange(tz, preset, from, to);
}
