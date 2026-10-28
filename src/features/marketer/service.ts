import "server-only";
import { Types, type PipelineStage } from "mongoose";
import { z } from "zod";
import { Company, CrmActivity, LeadAssignment, OUTREACH_STATUSES, User, type CompanyDoc, type LeadAssignmentDoc, type OutreachStatus, type UserDoc } from "@/models";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { can, effectivePermissions, isOwner, type Actor, type Role } from "@/lib/permissions";
import { escapeRegex } from "@/lib/utils";
import { companyTypeOf, COMPANY_TYPE_PARAMS, type CompanyType, type CompanyTypeParam } from "@/lib/company-classification";
import { formatPhone } from "@/lib/company-fields";
import { safeExternalUrl } from "@/lib/utils/url";
import { paginate, parseObjectId } from "@/lib/validation";

/**
 * Owner → shared Digital Marketer table.
 *
 *  - Only the Owner sends (from Startup Company Intelligence). "Send to Marketer" adds the company
 *    to the one shared table — there is no recipient to choose.
 *  - Every Digital Marketer holding "View Marketer Table" (`marketerLeads.view`, in the role
 *    template, so every marketer starts with it) sees every active row and can set its outreach
 *    status. The permission is eligible for the Digital Marketer role only, and gives nothing else.
 *  - One row per company (recipient null, unique index); repeats are no-ops, a withdrawn row is
 *    re-activated with history. The Company stays the source of truth.
 */

function assertCanSend(actor: Actor) {
  if (!isOwner(actor) || !can(actor, "leads.sendToMarketer")) throw Errors.forbidden();
}

/**
 * Who may read the shared table: Digital Marketers (who also set outreach statuses) and Admins
 * (read only), each with "View Marketer Table". Editing / deleting records is the management
 * table (features/marketer/owner-table), never this one.
 */
export function canReadMarketerTable(actor: Actor) {
  return (actor.role === "DIGITAL_MARKETER" || actor.role === "ADMIN") && can(actor, "marketerLeads.view");
}

/** A row of the shared table: no recipient. (Pre-2026-10-29 rows had one; see the model.) */
export const TABLE_ROW = { recipientId: null };

type MarketerUser = Pick<UserDoc, "_id" | "name" | "email" | "role" | "permissions"> & { permissionGrants?: { permission: string }[] };
const canViewTable = (u: MarketerUser) => effectivePermissions(u.role as Role, u.permissions, u.permissionGrants).includes("marketerLeads.view");

/** Active Digital Marketers who can open the table right now. */
async function tableViewers() {
  const marketers = await User.find({ role: "DIGITAL_MARKETER", status: "ACTIVE" }).select("name email role permissions permissionGrants").lean<MarketerUser[]>();
  return marketers.filter(canViewTable);
}

export type TableState = { assignment?: { id: string; status: string; sentAt: string }; viewers: number };

/** Is this company in the marketer table, and how many marketers can see the table? */
export async function marketerTableState(actor: Actor, companyId: string): Promise<TableState> {
  assertCanSend(actor);
  const [a, viewers] = await Promise.all([
    LeadAssignment.findOne({ companyId: parseObjectId(companyId), ...TABLE_ROW }).select("status sentAt").lean<LeadAssignmentDoc>(),
    tableViewers(),
  ]);
  return { assignment: a ? { id: String(a._id), status: a.status, sentAt: new Date(a.sentAt).toISOString() } : undefined, viewers: viewers.length };
}

export type SendResult = { status: "sent" | "resent" | "already"; assignmentId: string; /** Marketers who can see the table now. */ viewers: number };

export async function sendLeadToMarketer(actor: Actor, companyId: string): Promise<SendResult> {
  assertCanSend(actor);
  const company = await Company.findById(parseObjectId(companyId)).select("companyName countryCode isDemo").lean<CompanyDoc>();
  if (!company) throw Errors.notFound("Company not found");
  if (company.isDemo) throw Errors.badRequest("Demo companies can't be sent to marketers.");

  const now = new Date();
  const sender = new Types.ObjectId(actor.id);
  let status: SendResult["status"] = "sent";
  let assignment: LeadAssignmentDoc | null = null;
  try {
    // Atomic upsert: concurrent requests for the same company resolve to one table row.
    const res = await LeadAssignment.findOneAndUpdate(
      { companyId: company._id, ...TABLE_ROW },
      { $setOnInsert: { companyId: company._id, recipientId: null, senderId: sender, countryCode: company.countryCode, status: "ACTIVE", sentAt: now, history: [{ action: "SENT", actorId: sender, at: now }] } },
      { upsert: true, new: true, includeResultMetadata: true },
    ).lean<{ value: LeadAssignmentDoc; lastErrorObject?: { updatedExisting?: boolean } }>();
    assignment = res.value;
    if (res.lastErrorObject?.updatedExisting) status = "already";
  } catch (e) {
    if ((e as { code?: number }).code !== 11000) throw e;
    assignment = await LeadAssignment.findOne({ companyId: company._id, ...TABLE_ROW }).lean<LeadAssignmentDoc>();
    status = "already";
  }
  if (!assignment) throw Errors.conflict("Could not save the lead — please try again.");

  if (status === "already" && assignment.status === "WITHDRAWN") {
    const reopened = await LeadAssignment.findOneAndUpdate(
      { _id: assignment._id, status: "WITHDRAWN" },
      { $set: { status: "ACTIVE", sentAt: now, senderId: sender }, $unset: { withdrawnAt: 1 }, $push: { history: { action: "RESENT", actorId: sender, at: now } } },
      { new: true },
    ).lean<LeadAssignmentDoc>();
    if (reopened) {
      assignment = reopened;
      status = "resent";
    }
  }

  const viewers = await tableViewers();
  if (status !== "already") {
    await CrmActivity.create({ companyId: company._id, countryCode: company.countryCode, type: "ASSIGNMENT", body: "Sent to the Digital Marketer table", actorId: actor.id, meta: { leadAssignmentId: String(assignment._id) } });
    await audit(actor, status === "resent" ? "lead.resent_to_marketer" : "lead.sent_to_marketer", { entityType: "Company", entityId: String(company._id), countryCode: company.countryCode, metadata: { assignmentId: String(assignment._id), table: true, viewers: viewers.length } });
    // Only marketers who can open the table are told — otherwise the notice itself would leak the lead.
    if (viewers.length) {
      const { notifyUsers } = await import("@/features/notifications/service");
      await notifyUsers(viewers.map((v) => String(v._id)), { type: "SYSTEM", title: "New client lead", body: company.companyName, link: "/staff/client-leads" }).catch(() => undefined);
    }
  }
  return { status, assignmentId: String(assignment._id), viewers: viewers.length };
}

export async function withdrawLeadAssignment(actor: Actor, assignmentId: string) {
  assertCanSend(actor);
  const now = new Date();
  const id = parseObjectId(assignmentId);
  const a = await LeadAssignment.findOneAndUpdate(
    { _id: id, status: "ACTIVE" },
    { $set: { status: "WITHDRAWN", withdrawnAt: now }, $push: { history: { action: "WITHDRAWN", actorId: new Types.ObjectId(actor.id), at: now } } },
    { new: true },
  ).lean<LeadAssignmentDoc>();
  if (!a) {
    if (await LeadAssignment.exists({ _id: id })) return { ok: true, status: "WITHDRAWN" };
    throw Errors.notFound();
  }
  await CrmActivity.create({ companyId: a.companyId, countryCode: a.countryCode, type: "ASSIGNMENT", body: "Removed from the Digital Marketer table", actorId: actor.id, meta: { leadAssignmentId: String(a._id) } });
  await audit(actor, "lead.withdrawn_from_marketer", { entityType: "Company", entityId: String(a.companyId), countryCode: a.countryCode ?? undefined, metadata: { assignmentId: String(a._id), table: true } });
  return { ok: true, status: "WITHDRAWN" };
}

/** 1 for companies in the marketer table (the "sent" indicator in Today's New Companies). */
export async function activeAssignmentCounts(companyIds: (string | Types.ObjectId)[]) {
  if (!companyIds.length) return new Map<string, number>();
  const rows = await LeadAssignment.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { companyId: { $in: companyIds.map((id) => new Types.ObjectId(String(id))) }, status: "ACTIVE", ...TABLE_ROW } },
    { $group: { _id: "$companyId", n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

/* ───────────────────────── The marketer table (every Digital Marketer) ───────────────────────── */

export const MARKETER_LEAD_SORTS = ["sent", "company", "contact", "type"] as const;

export const COMPANY_PROJECTION = { companyName: 1, contactPerson: 1, phone: 1, mobile: 1, website: 1, countryCode: 1, "companyType.value": 1, "companyType.reason": 1, "companyType.manual": 1 };

/** What the table shows: the Owner's correction when there is one, otherwise the Company record. */
export const effectiveStage: PipelineStage = {
  $addFields: {
    eff: {
      companyName: { $ifNull: ["$details.companyName", "$company.companyName"] },
      contactPerson: { $ifNull: ["$details.contactPerson", "$company.contactPerson.name"] },
      contactRole: { $ifNull: ["$details.contactRole", "$company.contactPerson.role"] },
      phone: { $ifNull: ["$details.phone", { $ifNull: ["$company.phone", "$company.mobile"] }] },
      website: { $ifNull: ["$details.website", "$company.website"] },
    },
  },
};

export type Effective = { companyName?: string; contactPerson?: string; contactRole?: string; phone?: string; website?: string };

/** Search over the shown values (digits-only matching for phone numbers). */
export function searchMatch(q: string): PipelineStage {
  const rx = new RegExp(escapeRegex(q), "i");
  const or: Record<string, unknown>[] = [{ "eff.companyName": rx }, { "eff.contactPerson": rx }, { "eff.website": rx }, { "eff.phone": rx }];
  const digits = q.replace(/\D/g, "");
  // "+47 22 33" matches "4722 33…": compare digits only.
  if (digits.length >= 3) or.push({ "eff.phone": new RegExp(digits.split("").join("\\D*")) });
  return { $match: { $or: or } };
}

/** Row fields shown in both tables (an empty Owner correction = removed → "Not available"). */
export function shownFields(e: Effective, company: CompanyDoc | null | undefined) {
  const phone = e.phone || undefined;
  return {
    companyName: e.companyName || "(company removed)",
    contactPerson: e.contactPerson || undefined,
    contactRole: e.contactRole || undefined,
    phone,
    phoneDisplay: phone ? formatPhone(phone) : undefined,
    website: safeExternalUrl(e.website) ?? undefined,
    countryCode: company?.countryCode ?? undefined,
    companyType: { value: companyTypeOf(company?.companyType), reason: company?.companyType?.reason ?? undefined, manual: !!company?.companyType?.manual },
  };
}

export const marketerLeadQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  /** Company Type from the shared classification (the same value Company Intelligence shows). */
  type: z.enum(Object.keys(COMPANY_TYPE_PARAMS) as [CompanyTypeParam, ...CompanyTypeParam[]]).optional(),
  sort: z.enum(MARKETER_LEAD_SORTS).default("sent"),
  dir: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

export type MarketerLeadRow = {
  id: string;
  companyName: string;
  contactPerson?: string;
  contactRole?: string;
  phone?: string;
  phoneDisplay?: string;
  website?: { href: string; display: string };
  countryCode?: string;
  sentAt: string;
  companyType: { value: CompanyType; reason?: string; manual: boolean };
  /** The team's outreach progress on this lead (missing = NOT_REACHED). */
  outreachStatus: OutreachStatus;
  outreachStatusAt?: string;
};

export type MarketerLeadStats = { total: number; recent: number; withPhone: number; withWebsite: number; startup: number; established: number; review: number };

/**
 * The shared marketer table: every active lead the Owner sent. Requires a Digital Marketer with
 * "View Marketer Table"; returns only the contact fields the table shows (no registry, CRM or
 * research data) and never a withdrawn row.
 */
export async function listMarketerLeads(actor: Actor, input: unknown) {
  if (!canReadMarketerTable(actor)) throw Errors.forbidden();
  const q = marketerLeadQuerySchema.parse(input);
  const dir = q.dir === "asc" ? 1 : q.dir === "desc" ? -1 : q.sort === "sent" ? -1 : 1;
  const sortStage: Record<string, 1 | -1> =
    q.sort === "company" ? { "eff.companyName": dir, _id: 1 } : q.sort === "contact" ? { "eff.contactPerson": dir, _id: 1 } : q.sort === "type" ? { "company.companyType.value": dir, sentAt: -1, _id: 1 } : { sentAt: dir, _id: 1 };
  const base: PipelineStage[] = [
    { $match: { ...TABLE_ROW, status: "ACTIVE" } },
    { $lookup: { from: Company.collection.name, localField: "companyId", foreignField: "_id", as: "company", pipeline: [{ $project: COMPANY_PROJECTION }] } },
    { $unwind: "$company" },
    effectiveStage,
  ];
  const pipeline: PipelineStage[] = [...base];
  if (q.type) {
    const value = COMPANY_TYPE_PARAMS[q.type];
    pipeline.push({ $match: value === "NEEDS_REVIEW" ? { "company.companyType.value": { $nin: ["STARTUP", "ESTABLISHED"] } } : { "company.companyType.value": value } });
  }
  if (q.q) pipeline.push(searchMatch(q.q));
  pipeline.push({ $sort: sortStage }, { $facet: { items: [{ $skip: (q.page - 1) * q.pageSize }, { $limit: q.pageSize }], total: [{ $count: "n" }] } });
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [[res], [stats]] = await Promise.all([
    LeadAssignment.aggregate<{ items: (LeadAssignmentDoc & { company: CompanyDoc; eff: Effective })[]; total: { n: number }[] }>(pipeline),
    // Summary cards: every active lead in the table (independent of search / type filter).
    LeadAssignment.aggregate<MarketerLeadStats>([
      ...base,
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          recent: { $sum: { $cond: [{ $gte: ["$sentAt", since] }, 1, 0] } },
          withPhone: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ["$eff.phone", ""] } }, 0] }, 1, 0] } },
          withWebsite: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ["$eff.website", ""] } }, 0] }, 1, 0] } },
          startup: { $sum: { $cond: [{ $eq: ["$company.companyType.value", "STARTUP"] }, 1, 0] } },
          established: { $sum: { $cond: [{ $eq: ["$company.companyType.value", "ESTABLISHED"] }, 1, 0] } },
        },
      },
      { $project: { _id: 0, total: 1, recent: 1, withPhone: 1, withWebsite: 1, startup: 1, established: 1, review: { $subtract: ["$total", { $add: ["$startup", "$established"] }] } } },
    ]),
  ]);
  const items: MarketerLeadRow[] = (res?.items ?? []).map((a) => ({
    ...shownFields(a.eff, a.company),
    id: String(a._id),
    sentAt: new Date(a.sentAt).toISOString(),
    outreachStatus: (a.outreachStatus as OutreachStatus | undefined) ?? "NOT_REACHED",
    outreachStatusAt: a.outreachStatusAt ? new Date(a.outreachStatusAt).toISOString() : undefined,
  }));
  return {
    ...paginate(items, res?.total[0]?.n ?? 0, q.page, q.pageSize),
    sort: q.sort,
    dir: dir === 1 ? ("asc" as const) : ("desc" as const),
    q: q.q ?? "",
    type: q.type ?? null,
    stats: stats ?? { total: 0, recent: 0, withPhone: 0, withWebsite: 0, startup: 0, established: 0, review: 0 },
  };
}

/** Strict: a payload carrying any other field (company name, contact, details, status …) is rejected, not ignored. */
export const outreachStatusSchema = z.object({ outreachStatus: z.enum(OUTREACH_STATUSES) }).strict();

/**
 * A Digital Marketer sets the outreach status of an active lead in the table (Admins only read
 * the table — this stays Digital Marketer only). The status is
 * shared by the team (one row per company); only outreachStatus is ever written (strict schema,
 * fixed $set). Recorded with who, when and the previous value in the history and the audit log.
 */
export async function updateLeadOutreachStatus(actor: Actor, assignmentId: string, input: unknown) {
  if (actor.role !== "DIGITAL_MARKETER" || !can(actor, "marketerLeads.view")) throw Errors.forbidden();
  const { outreachStatus } = outreachStatusSchema.parse(input);
  const now = new Date();
  const me = new Types.ObjectId(actor.id);
  const prev = await LeadAssignment.findOneAndUpdate(
    { _id: parseObjectId(assignmentId), ...TABLE_ROW, status: "ACTIVE" },
    { $set: { outreachStatus, outreachStatusAt: now, outreachStatusBy: me } },
    { new: false },
  ).lean<LeadAssignmentDoc>();
  if (!prev) throw Errors.notFound("Lead not found");
  const previousOutreachStatus = (prev.outreachStatus as OutreachStatus | undefined) ?? "NOT_REACHED";
  await LeadAssignment.updateOne({ _id: prev._id }, { $push: { history: { action: "OUTREACH", actorId: me, at: now, outreachStatus, previousOutreachStatus } } });
  await audit(actor, "lead.outreach_status_changed", { entityType: "Company", entityId: String(prev.companyId), countryCode: prev.countryCode ?? undefined, metadata: { assignmentId: String(prev._id), outreachStatus, previousOutreachStatus } });
  return { id: String(prev._id), outreachStatus, outreachStatusAt: now.toISOString() };
}

/** Number of active leads in the marketer table (only with "View Marketer Table"). */
export async function countMyLeads(actor: Actor) {
  if (!canReadMarketerTable(actor)) throw Errors.forbidden();
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [total, recent] = await Promise.all([
    LeadAssignment.countDocuments({ ...TABLE_ROW, status: "ACTIVE" }),
    LeadAssignment.countDocuments({ ...TABLE_ROW, status: "ACTIVE", sentAt: { $gte: since } }),
  ]);
  return { total, recent };
}
