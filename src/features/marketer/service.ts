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
import { objectId, paginate, parseObjectId } from "@/lib/validation";

/**
 * Owner → Digital Marketer lead handoff.
 *
 *  - Only the Owner sends (it starts in Company Intelligence, which is Owner-only).
 *  - One assignment per company + recipient (unique index); repeats are no-ops, a withdrawn
 *    assignment is re-activated with history. The Company stays the source of truth.
 *  - Sending never grants access: the marketer sees the lead only while they hold
 *    "View Assigned Client Leads", and only leads assigned to them.
 */

function assertCanSend(actor: Actor) {
  if (!isOwner(actor) || !can(actor, "leads.sendToMarketer")) throw Errors.forbidden();
}

type MarketerUser = Pick<UserDoc, "_id" | "name" | "email" | "role" | "permissions"> & { permissionGrants?: { permission: string }[] };
const canViewLeads = (u: MarketerUser) => effectivePermissions(u.role as Role, u.permissions, u.permissionGrants).includes("marketerLeads.view");

export type MarketerRecipient = {
  id: string;
  name: string;
  email: string;
  /** Holds "View Assigned Client Leads" — the lead is visible to them right away. */
  canView: boolean;
  assignment?: { id: string; status: string; sentAt: string };
};

/** Active Digital Marketers, with this company's assignment state (for the recipient picker). */
export async function listMarketerRecipients(actor: Actor, companyId: string): Promise<MarketerRecipient[]> {
  assertCanSend(actor);
  const cid = parseObjectId(companyId);
  const [marketers, assignments] = await Promise.all([
    User.find({ role: "DIGITAL_MARKETER", status: "ACTIVE" }).select("name email role permissions permissionGrants").sort({ name: 1 }).lean<MarketerUser[]>(),
    LeadAssignment.find({ companyId: cid }).select("recipientId status sentAt").lean<LeadAssignmentDoc[]>(),
  ]);
  const byRecipient = new Map(assignments.map((a) => [String(a.recipientId), a]));
  return marketers.map((m) => {
    const a = byRecipient.get(String(m._id));
    return { id: String(m._id), name: m.name, email: m.email, canView: canViewLeads(m), assignment: a ? { id: String(a._id), status: a.status, sentAt: new Date(a.sentAt).toISOString() } : undefined };
  });
}

export const sendLeadSchema = z.object({ recipientId: objectId });

export type SendResult = { status: "sent" | "resent" | "already"; assignmentId: string; recipient: { id: string; name: string }; visible: boolean };

export async function sendLeadToMarketer(actor: Actor, companyId: string, input: unknown): Promise<SendResult> {
  assertCanSend(actor);
  const { recipientId } = sendLeadSchema.parse(input);
  const company = await Company.findById(parseObjectId(companyId)).select("companyName countryCode isDemo").lean<CompanyDoc>();
  if (!company) throw Errors.notFound("Company not found");
  if (company.isDemo) throw Errors.badRequest("Demo companies can't be sent to marketers.");
  const recipient = await User.findOne({ _id: new Types.ObjectId(recipientId), role: "DIGITAL_MARKETER", status: "ACTIVE" }).select("name email role permissions permissionGrants").lean<MarketerUser>();
  if (!recipient) throw Errors.badRequest("Choose an active Digital Marketer.");

  const now = new Date();
  const sender = new Types.ObjectId(actor.id);
  let status: SendResult["status"] = "sent";
  let assignment: LeadAssignmentDoc | null = null;
  try {
    // Atomic upsert: concurrent requests for the same company + recipient resolve to one document.
    const res = await LeadAssignment.findOneAndUpdate(
      { companyId: company._id, recipientId: recipient._id },
      { $setOnInsert: { companyId: company._id, recipientId: recipient._id, senderId: sender, countryCode: company.countryCode, status: "ACTIVE", sentAt: now, history: [{ action: "SENT", actorId: sender, at: now }] } },
      { upsert: true, new: true, includeResultMetadata: true },
    ).lean<{ value: LeadAssignmentDoc; lastErrorObject?: { updatedExisting?: boolean } }>();
    assignment = res.value;
    if (res.lastErrorObject?.updatedExisting) status = "already";
  } catch (e) {
    if ((e as { code?: number }).code !== 11000) throw e;
    assignment = await LeadAssignment.findOne({ companyId: company._id, recipientId: recipient._id }).lean<LeadAssignmentDoc>();
    status = "already";
  }
  if (!assignment) throw Errors.conflict("Could not save the assignment — please try again.");

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

  const visible = canViewLeads(recipient);
  if (status !== "already") {
    await CrmActivity.create({ companyId: company._id, countryCode: company.countryCode, type: "ASSIGNMENT", body: `Sent to Digital Marketer ${recipient.name}`, actorId: actor.id, meta: { leadAssignmentId: String(assignment._id), recipientId: String(recipient._id) } });
    await audit(actor, status === "resent" ? "lead.resent_to_marketer" : "lead.sent_to_marketer", { entityType: "Company", entityId: String(company._id), countryCode: company.countryCode, metadata: { recipientId: String(recipient._id), assignmentId: String(assignment._id), visibleNow: visible } });
    // Only someone who may see the lead is told about it — otherwise the notice itself would leak it.
    if (visible) {
      const { notifyUsers } = await import("@/features/notifications/service");
      await notifyUsers([String(recipient._id)], { type: "SYSTEM", title: "New client lead", body: company.companyName, link: "/staff/client-leads" }).catch(() => undefined);
    }
  }
  return { status, assignmentId: String(assignment._id), recipient: { id: String(recipient._id), name: recipient.name }, visible };
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
  await CrmActivity.create({ companyId: a.companyId, countryCode: a.countryCode, type: "ASSIGNMENT", body: "Withdrawn from Digital Marketer", actorId: actor.id, meta: { leadAssignmentId: String(a._id), recipientId: String(a.recipientId) } });
  await audit(actor, "lead.withdrawn_from_marketer", { entityType: "Company", entityId: String(a.companyId), countryCode: a.countryCode ?? undefined, metadata: { recipientId: String(a.recipientId), assignmentId: String(a._id) } });
  return { ok: true, status: "WITHDRAWN" };
}

/** Active assignment counts per company (for the "sent" indicator in Today's New Companies). */
export async function activeAssignmentCounts(companyIds: (string | Types.ObjectId)[]) {
  if (!companyIds.length) return new Map<string, number>();
  const rows = await LeadAssignment.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { companyId: { $in: companyIds.map((id) => new Types.ObjectId(String(id))) }, status: "ACTIVE" } },
    { $group: { _id: "$companyId", n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

/* ───────────────────────── Marketer's own table ───────────────────────── */

export const MARKETER_LEAD_SORTS = ["sent", "company", "contact", "type"] as const;

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
  /** The marketer's own outreach progress (missing = NOT_REACHED). */
  outreachStatus: OutreachStatus;
  outreachStatusAt?: string;
};

export type MarketerLeadStats = { total: number; recent: number; withPhone: number; withWebsite: number; startup: number; established: number; review: number };

/**
 * Leads assigned to the signed-in Digital Marketer. Requires "View Assigned Client Leads";
 * the query is always scoped to the actor's own active assignments and returns only the
 * contact fields the table shows (no registry, CRM or research data).
 */
export async function listMarketerLeads(actor: Actor, input: unknown) {
  if (actor.role !== "DIGITAL_MARKETER" || !can(actor, "marketerLeads.view")) throw Errors.forbidden();
  const q = marketerLeadQuerySchema.parse(input);
  const dir = q.dir === "asc" ? 1 : q.dir === "desc" ? -1 : q.sort === "sent" ? -1 : 1;
  const sortStage: Record<string, 1 | -1> =
    q.sort === "company" ? { "company.companyName": dir, _id: 1 } : q.sort === "contact" ? { "company.contactPerson.name": dir, _id: 1 } : q.sort === "type" ? { "company.companyType.value": dir, sentAt: -1, _id: 1 } : { sentAt: dir, _id: 1 };
  const base: PipelineStage[] = [
    { $match: { recipientId: new Types.ObjectId(actor.id), status: "ACTIVE" } },
    { $lookup: { from: Company.collection.name, localField: "companyId", foreignField: "_id", as: "company", pipeline: [{ $project: { companyName: 1, contactPerson: 1, phone: 1, mobile: 1, website: 1, countryCode: 1, "companyType.value": 1, "companyType.reason": 1, "companyType.manual": 1 } }] } },
    { $unwind: "$company" },
  ];
  const pipeline: PipelineStage[] = [...base];
  if (q.type) {
    const value = COMPANY_TYPE_PARAMS[q.type];
    pipeline.push({ $match: value === "NEEDS_REVIEW" ? { "company.companyType.value": { $nin: ["STARTUP", "ESTABLISHED"] } } : { "company.companyType.value": value } });
  }
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    const digits = q.q.replace(/\D/g, "");
    const or: Record<string, unknown>[] = [{ "company.companyName": rx }, { "company.contactPerson.name": rx }, { "company.website": rx }, { "company.phone": rx }, { "company.mobile": rx }];
    if (digits.length >= 3) {
      // "+47 22 33" matches "4722 33…": compare digits only.
      const loose = new RegExp(digits.split("").join("\\D*"));
      or.push({ "company.phone": loose }, { "company.mobile": loose });
    }
    pipeline.push({ $match: { $or: or } });
  }
  pipeline.push({ $sort: sortStage }, { $facet: { items: [{ $skip: (q.page - 1) * q.pageSize }, { $limit: q.pageSize }], total: [{ $count: "n" }] } });
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [[res], [stats]] = await Promise.all([
    LeadAssignment.aggregate<{ items: (LeadAssignmentDoc & { company: CompanyDoc })[]; total: { n: number }[] }>(pipeline),
    // Summary cards: all of this marketer's active leads (independent of search / type filter).
    LeadAssignment.aggregate<MarketerLeadStats>([
      ...base,
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          recent: { $sum: { $cond: [{ $gte: ["$sentAt", since] }, 1, 0] } },
          withPhone: { $sum: { $cond: [{ $or: [{ $gt: [{ $strLenCP: { $ifNull: ["$company.phone", ""] } }, 0] }, { $gt: [{ $strLenCP: { $ifNull: ["$company.mobile", ""] } }, 0] }] }, 1, 0] } },
          withWebsite: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ["$company.website", ""] } }, 0] }, 1, 0] } },
          startup: { $sum: { $cond: [{ $eq: ["$company.companyType.value", "STARTUP"] }, 1, 0] } },
          established: { $sum: { $cond: [{ $eq: ["$company.companyType.value", "ESTABLISHED"] }, 1, 0] } },
        },
      },
      { $project: { _id: 0, total: 1, recent: 1, withPhone: 1, withWebsite: 1, startup: 1, established: 1, review: { $subtract: ["$total", { $add: ["$startup", "$established"] }] } } },
    ]),
  ]);
  const items: MarketerLeadRow[] = (res?.items ?? []).map((a) => {
    const phone = a.company.phone ?? a.company.mobile ?? undefined;
    return {
      id: String(a._id),
      companyName: a.company.companyName,
      contactPerson: a.company.contactPerson?.name ?? undefined,
      contactRole: a.company.contactPerson?.role ?? undefined,
      phone,
      phoneDisplay: phone ? formatPhone(phone) : undefined,
      website: safeExternalUrl(a.company.website) ?? undefined,
      countryCode: a.company.countryCode,
      sentAt: new Date(a.sentAt).toISOString(),
      companyType: { value: companyTypeOf(a.company.companyType), reason: a.company.companyType?.reason ?? undefined, manual: !!a.company.companyType?.manual },
      outreachStatus: (a.outreachStatus as OutreachStatus | undefined) ?? "NOT_REACHED",
      outreachStatusAt: a.outreachStatusAt ? new Date(a.outreachStatusAt).toISOString() : undefined,
    };
  });
  return {
    ...paginate(items, res?.total[0]?.n ?? 0, q.page, q.pageSize),
    sort: q.sort,
    dir: dir === 1 ? ("asc" as const) : ("desc" as const),
    q: q.q ?? "",
    type: q.type ?? null,
    stats: stats ?? { total: 0, recent: 0, withPhone: 0, withWebsite: 0, startup: 0, established: 0, review: 0 },
  };
}

export const outreachStatusSchema = z.object({ outreachStatus: z.enum(OUTREACH_STATUSES) });

/**
 * The signed-in marketer sets the outreach status of one of their own active leads. Scoped to
 * the assignment (company + this marketer), so it never changes another lead or another
 * marketer's progress. Recorded in the assignment history and the audit log.
 */
export async function updateLeadOutreachStatus(actor: Actor, assignmentId: string, input: unknown) {
  if (actor.role !== "DIGITAL_MARKETER" || !can(actor, "marketerLeads.view")) throw Errors.forbidden();
  const { outreachStatus } = outreachStatusSchema.parse(input);
  const now = new Date();
  const me = new Types.ObjectId(actor.id);
  const a = await LeadAssignment.findOneAndUpdate(
    { _id: parseObjectId(assignmentId), recipientId: me, status: "ACTIVE" },
    { $set: { outreachStatus, outreachStatusAt: now }, $push: { history: { action: "OUTREACH", actorId: me, at: now, outreachStatus } } },
    { new: true },
  ).lean<LeadAssignmentDoc>();
  if (!a) throw Errors.notFound("Lead not found");
  await audit(actor, "lead.outreach_status_changed", { entityType: "Company", entityId: String(a.companyId), countryCode: a.countryCode ?? undefined, metadata: { assignmentId: String(a._id), outreachStatus } });
  return { id: String(a._id), outreachStatus, outreachStatusAt: now.toISOString() };
}

/** Number of active leads for the signed-in marketer (only with "View Assigned Client Leads"). */
export async function countMyLeads(actor: Actor) {
  if (actor.role !== "DIGITAL_MARKETER" || !can(actor, "marketerLeads.view")) throw Errors.forbidden();
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [total, recent] = await Promise.all([
    LeadAssignment.countDocuments({ recipientId: new Types.ObjectId(actor.id), status: "ACTIVE" }),
    LeadAssignment.countDocuments({ recipientId: new Types.ObjectId(actor.id), status: "ACTIVE", sentAt: { $gte: since } }),
  ]);
  return { total, recent };
}
