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

/** Owner delivery uses the existing centralized assignment collection. Shared membership
 * and personal handling are distinct; Company remains the source of client details. */

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

/** Explicit private marker excludes legacy merged rows from every read and write. */
export const ASSIGNMENT_ROWS = { mergedInto: { $exists: false }, $or: [{ recipientId: null }, { destinationType: "individual" }] };
export function accessibleAssignments(actor: Actor, scope = "all", recipientId?: string): Record<string, unknown> {
  const manager = isOwner(actor) || (actor.role === "ADMIN" && can(actor, "marketerTable.manage"));
  if (scope === "shared") return TABLE_ROW;
  if (scope === "mine") return { destinationType: "individual", recipientId: parseObjectId(actor.id) };
  if (scope === "individual" || recipientId) {
    if (!manager) throw Errors.forbidden();
    return { destinationType: "individual", ...(recipientId ? { recipientId: parseObjectId(recipientId) } : {}) };
  }
  return manager ? ASSIGNMENT_ROWS : { $or: [TABLE_ROW, { destinationType: "individual", recipientId: parseObjectId(actor.id) }] };
}

export async function eligibleMarketers(actor: Actor) {
  assertCanSend(actor);
  return (await assignmentRecipients()).map((u) => ({ id: String(u._id), name: u.name, email: u.email, role: u.role }));
}

export const deliverySchema = z.discriminatedUnion("destinationType", [
  z.object({ destinationType: z.literal("shared"), recipientId: z.never().optional() }).strict(),
  z.object({ destinationType: z.literal("individual"), recipientId: z.string().regex(/^[a-f\d]{24}$/i) }).strict(),
]);
export type Delivery = z.infer<typeof deliverySchema>;

type MarketerUser = Pick<UserDoc, "_id" | "name" | "email" | "role" | "permissions"> & { permissionGrants?: { permission: string }[] };
const canViewTable = (u: MarketerUser) => effectivePermissions(u.role as Role, u.permissions, u.permissionGrants).includes("marketerLeads.view");

/** Active Digital Marketers who can open the table right now. */
async function tableViewers() {
  const marketers = await User.find({ role: "DIGITAL_MARKETER", status: "ACTIVE" }).select("name email role permissions permissionGrants").lean<MarketerUser[]>();
  return marketers.filter(canViewTable);
}

/** Active accounts whose existing role grants access to personal leads. */
export async function assignmentRecipients() {
  const users = await User.find({ role: { $in: ["DIGITAL_MARKETER", "ADMIN"] }, status: "ACTIVE" }).select("name email role permissions permissionGrants").sort({ name: 1 }).lean<MarketerUser[]>();
  return users.filter(canViewTable);
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

export async function sendLeadToMarketer(actor: Actor, companyId: string, input: Delivery = { destinationType: "shared" }): Promise<SendResult> {
  assertCanSend(actor);
  const delivery = deliverySchema.parse(input);
  const viewers = await tableViewers();
  const recipients = delivery.destinationType === "individual" ? await assignmentRecipients() : [];
  const recipient = delivery.destinationType === "individual" ? recipients.find((u) => String(u._id) === delivery.recipientId) : undefined;
  if (delivery.destinationType === "individual" && !recipient) throw Errors.badRequest("Select an active marketer or admin with table access.");
  const destination = { recipientId: recipient ? recipient._id : null };
  const company = await Company.findById(parseObjectId(companyId)).select("companyName countryCode isDemo").lean<CompanyDoc>();
  if (!company) throw Errors.notFound("Company not found");
  if (company.isDemo) throw Errors.badRequest("Demo companies can't be sent to marketers.");

  if (recipient) {
    const existing = await LeadAssignment.findOne({ companyId: company._id, destinationType: "individual", status: "ACTIVE", recipientId: { $ne: recipient._id }, mergedInto: { $exists: false } }).lean<LeadAssignmentDoc>();
    if (existing) {
      const handler = await User.findById(existing.recipientId).select("name").lean<{ name: string }>();
      throw Errors.conflict(`Already assigned to ${handler?.name ?? "another user"}; outreach status: ${existing.outreachStatus ?? "NOT_REACHED"}. Reassign from the management table.`);
    }
  }
  const now = new Date();
  const sender = new Types.ObjectId(actor.id);
  let status: SendResult["status"] = "sent";
  let assignment: LeadAssignmentDoc | null = null;
  try {
    // Atomic upsert: concurrent requests for the same company resolve to one table row.
    const res = await LeadAssignment.findOneAndUpdate(
      { companyId: company._id, ...destination },
      { $setOnInsert: { companyId: company._id, ...destination, destinationType: delivery.destinationType, senderId: sender, countryCode: company.countryCode, status: "ACTIVE", sentAt: now, history: [{ action: "SENT", actorId: sender, at: now }] } },
      { upsert: true, new: true, includeResultMetadata: true },
    ).lean<{ value: LeadAssignmentDoc; lastErrorObject?: { updatedExisting?: boolean } }>();
    assignment = res.value;
    if (res.lastErrorObject?.updatedExisting) status = "already";
  } catch (e) {
    if ((e as { code?: number }).code !== 11000) throw e;
    assignment = await LeadAssignment.findOne({ companyId: company._id, ...destination }).lean<LeadAssignmentDoc>();
    status = "already";
  }
  if (!assignment) throw Errors.conflict("Another assignment may already exist. Reload and review the assigned person. Could not save the lead — please try again.");
  if (assignment.mergedInto) throw Errors.conflict("This recipient has an archived legacy assignment. Ask the Owner to review its history before sending.");

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

  const notified = recipient ? [recipient] : viewers;
  if (status !== "already") {
    await CrmActivity.create({ companyId: company._id, countryCode: company.countryCode, type: "ASSIGNMENT", body: recipient ? "Sent to an individual Digital Marketer" : "Sent to the Digital Marketer table", actorId: actor.id, meta: { leadAssignmentId: String(assignment._id), destinationType: delivery.destinationType, recipientId: recipient ? String(recipient._id) : null } });
    await audit(actor, status === "resent" ? "lead.resent_to_marketer" : "lead.sent_to_marketer", { entityType: "Company", entityId: String(company._id), countryCode: company.countryCode, metadata: { assignmentId: String(assignment._id), destinationType: delivery.destinationType, recipientId: recipient ? String(recipient._id) : null, viewers: notified.length } });
    // Only marketers who can open the table are told — otherwise the notice itself would leak the lead.
    if (notified.length) {
      const { notifyUsers } = await import("@/features/notifications/service");
      await notifyUsers(notified.map((v) => String(v._id)), { type: "SYSTEM", title: "New client lead", body: company.companyName, link: "/staff/client-leads" }).catch(() => undefined);
    }
  }
  return { status, assignmentId: String(assignment._id), viewers: notified.length };
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
  scope: z.enum(["all", "shared", "mine", "individual"]).default("all"),
  recipientId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  outreach: z.enum(OUTREACH_STATUSES).optional(),
  q: z.string().trim().max(120).optional(),
  /** Company Type from the shared classification (the same value Company Intelligence shows). */
  type: z.enum(Object.keys(COMPANY_TYPE_PARAMS) as [CompanyTypeParam, ...CompanyTypeParam[]]).optional(),
  sort: z.enum(MARKETER_LEAD_SORTS).default("sent"),
  dir: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

export type MarketerLeadRow = {
  destinationType?: "shared" | "individual";
  recipientId?: string;
  recipientName?: string;
  handledBy?: string;
  handlerOutreachStatus?: string;
  outreachStatusBy?: string;
  canUpdateOutreach?: boolean;
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
    { $match: { ...accessibleAssignments(actor, q.scope, q.recipientId), status: "ACTIVE", mergedInto: { $exists: false } } },
    { $lookup: { from: Company.collection.name, localField: "companyId", foreignField: "_id", as: "company", pipeline: [{ $project: COMPANY_PROJECTION }] } },
    { $unwind: "$company" },
    effectiveStage,
  ];
  const pipeline: PipelineStage[] = [...base];
  if (q.outreach) pipeline.push({ $match: { outreachStatus: q.outreach === "NOT_REACHED" ? { $in: [null, "NOT_REACHED"] } : q.outreach } });
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
  const handlers = await LeadAssignment.find({ companyId: { $in: (res?.items ?? []).filter((a) => !a.recipientId).map((a) => a.companyId) }, destinationType: "individual", status: "ACTIVE", mergedInto: { $exists: false } }).select("companyId recipientId outreachStatus").lean<LeadAssignmentDoc[]>();
  const handlerByCompany = new Map(handlers.map((a) => [String(a.companyId), a]));
  const userIds = [...new Set([...(res?.items ?? []), ...handlers].flatMap((a) => [a.recipientId, a.outreachStatusBy].filter(Boolean).map(String)))];
  const users = await User.find({ _id: { $in: userIds } }).select("name").lean<{ _id: Types.ObjectId; name: string }[]>();
  const names = new Map(users.map((u) => [String(u._id), u.name]));
  const items: MarketerLeadRow[] = (res?.items ?? []).map((a) => ({
    ...shownFields(a.eff, a.company),
    id: String(a._id),
    destinationType: a.recipientId ? "individual" : "shared",
    recipientId: a.recipientId ? String(a.recipientId) : undefined,
    recipientName: a.recipientId ? names.get(String(a.recipientId)) ?? "Deleted user" : undefined,
    outreachStatusBy: a.outreachStatusBy ? names.get(String(a.outreachStatusBy)) ?? "Deleted user" : undefined,
    handledBy: !a.recipientId && handlerByCompany.has(String(a.companyId)) ? names.get(String(handlerByCompany.get(String(a.companyId))!.recipientId)) ?? "Assigned user" : undefined,
    handlerOutreachStatus: !a.recipientId ? handlerByCompany.get(String(a.companyId))?.outreachStatus ?? undefined : undefined,
    canUpdateOutreach: !(!a.recipientId && handlerByCompany.has(String(a.companyId))) && (actor.role === "DIGITAL_MARKETER" || (actor.role === "ADMIN" && String(a.recipientId) === actor.id)),
    sentAt: new Date(a.sentAt).toISOString(),
    outreachStatus: (a.outreachStatus as OutreachStatus | undefined) ?? "NOT_REACHED",
    outreachStatusAt: a.outreachStatusAt ? new Date(a.outreachStatusAt).toISOString() : undefined,
  }));
  return {
    ...paginate(items, res?.total[0]?.n ?? 0, q.page, q.pageSize),
    sort: q.sort,
    dir: dir === 1 ? ("asc" as const) : ("desc" as const),
    q: q.q ?? "",
    scope: q.scope,
    outreach: q.outreach ?? "",
    type: q.type ?? null,
    stats: stats ?? { total: 0, recent: 0, withPhone: 0, withWebsite: 0, startup: 0, established: 0, review: 0 },
  };
}

/** Strict: a payload carrying any other field (company name, contact, details, status …) is rejected, not ignored. */
export const outreachStatusSchema = z.object({ outreachStatus: z.enum(OUTREACH_STATUSES) }).strict();

/** Save an actual outreach change and its history atomically, rejecting stale writes.
 * Admins may update their own personal assignments; management uses owner-table. */
export async function updateLeadOutreachStatus(actor: Actor, assignmentId: string, input: unknown) {
  if (!canReadMarketerTable(actor)) throw Errors.forbidden();
  const { outreachStatus } = outreachStatusSchema.parse(input);
  const filter = { _id: parseObjectId(assignmentId), ...accessibleAssignments(actor, "all"), mergedInto: { $exists: false }, status: "ACTIVE" };
  const prev = await LeadAssignment.findOne(filter).lean<LeadAssignmentDoc>();
  if (!prev) throw Errors.notFound("Lead not found");
  if (actor.role === "ADMIN" && String(prev.recipientId) !== actor.id) throw Errors.forbidden("Admins may update their personal assignments; shared records require management access.");
  if (!prev.recipientId) {
    const assigned = await LeadAssignment.findOne({ companyId: prev.companyId, destinationType: "individual", status: "ACTIVE", mergedInto: { $exists: false } }).lean<LeadAssignmentDoc>();
    if (assigned) {
      const handler = await User.findById(assigned.recipientId).select("name").lean<{ name: string }>();
      throw Errors.conflict(`Handled by ${handler?.name ?? "another user"}; outreach status: ${assigned.outreachStatus ?? "NOT_REACHED"}. Use the personal assignment or ask an authorized admin to reassign it.`);
    }
  }
  const previousOutreachStatus = (prev.outreachStatus as OutreachStatus | undefined) ?? "NOT_REACHED";
  if (previousOutreachStatus === outreachStatus) return { id: String(prev._id), outreachStatus, outreachStatusAt: prev.outreachStatusAt?.toISOString() };
  const now = new Date();
  const me = new Types.ObjectId(actor.id);
  const result = await LeadAssignment.updateOne(
    { ...filter, recipientId: prev.recipientId, outreachStatus: prev.outreachStatus ?? null },
    { $set: { outreachStatus, outreachStatusAt: now, outreachStatusBy: me }, $push: { history: { action: "OUTREACH", actorId: me, at: now, outreachStatus, previousOutreachStatus } } },
  );
  if (!result.modifiedCount) throw Errors.conflict("This lead changed. Reload before updating its outreach status.");
  await audit(actor, "lead.outreach_status_changed", { entityType: "Company", entityId: String(prev.companyId), countryCode: prev.countryCode ?? undefined, metadata: { assignmentId: String(prev._id), outreachStatus, previousOutreachStatus } });
  return { id: String(prev._id), outreachStatus, outreachStatusAt: now.toISOString() };
}

/** Number of active leads in the marketer table (only with "View Marketer Table"). */
export async function countMyLeads(actor: Actor) {
  if (!canReadMarketerTable(actor)) throw Errors.forbidden();
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [total, recent] = await Promise.all([
    LeadAssignment.countDocuments({ ...accessibleAssignments(actor), mergedInto: { $exists: false }, status: "ACTIVE" }),
    LeadAssignment.countDocuments({ ...accessibleAssignments(actor), mergedInto: { $exists: false }, status: "ACTIVE", sentAt: { $gte: since } }),
  ]);
  return { total, recent };
}
