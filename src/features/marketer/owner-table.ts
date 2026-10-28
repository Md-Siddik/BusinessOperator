import "server-only";
import { Types, type PipelineStage } from "mongoose";
import { z } from "zod";
import { Company, CrmActivity, LEAD_ASSIGNMENT_STATUSES, LeadAssignment, OUTREACH_STATUSES, User, type CompanyDoc, type LeadAssignmentDoc, type OutreachStatus, type UserDoc } from "@/models";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { can, isOwner, type Actor } from "@/lib/permissions";
import { safeExternalUrl } from "@/lib/utils/url";
import { paginate, parseObjectId } from "@/lib/validation";
import { COMPANY_PROJECTION, effectiveStage, searchMatch, shownFields, TABLE_ROW, type Effective, type MarketerLeadRow } from "./service";

/**
 * Management table: the Owner, and Admins the Owner granted "Manage Marketer Table" (the
 * "Super Admin" capability — an Owner grant, never delegable). They view every record, correct
 * the shown company / contact fields, sets any outreach status, withdraws, re-activates or
 * deletes a record, and reads each record's change history (who, when, from → to).
 * Checked here and on every route (`marketerTable.manage`; the Owner holds it by role).
 * Corrections are stored on the assignment; the Company record is never changed from here.
 */
export function canManageMarketerTable(actor: Actor | null | undefined) {
  return !!actor && (isOwner(actor) || (actor.role === "ADMIN" && can(actor, "marketerTable.manage")));
}

function assertOwnerTable(actor: Actor) {
  if (!canManageMarketerTable(actor)) throw Errors.forbidden();
}

export const ownerLeadQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  outreach: z.enum(OUTREACH_STATUSES).optional(),
  status: z.enum(["ACTIVE", "WITHDRAWN", "ALL"]).default("ALL"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});
type OwnerLeadQuery = z.infer<typeof ownerLeadQuerySchema>;

export type LeadHistoryEntry = { action: string; at: string; by: string; outreachStatus?: OutreachStatus; previousOutreachStatus?: OutreachStatus; fields?: string[] };

export type OwnerLeadRow = MarketerLeadRow & {
  companyId: string;
  status: "ACTIVE" | "WITHDRAWN";
  outreachStatusBy?: string;
  /** Values stored on the Company record (shown next to an Owner correction). */
  original: Effective;
  /** Raw shown values for the edit form. */
  values: Required<Effective>;
  edited?: { at: string; by: string; fields: string[] };
  history: LeadHistoryEntry[];
};

const DETAIL_FIELDS = ["companyName", "contactPerson", "contactRole", "phone", "website"] as const;
type DetailField = (typeof DETAIL_FIELDS)[number];
type Details = Effective & { editedAt?: Date; editedBy?: Types.ObjectId };

const originalOf = (c: CompanyDoc | null | undefined): Effective => ({
  companyName: c?.companyName,
  contactPerson: c?.contactPerson?.name ?? undefined,
  contactRole: c?.contactPerson?.role ?? undefined,
  phone: c?.phone ?? c?.mobile ?? undefined,
  website: c?.website ?? undefined,
});

async function ownerRows(match: Record<string, unknown>, q?: OwnerLeadQuery) {
  const pipeline: PipelineStage[] = [
    { $match: { ...match, ...TABLE_ROW } },
    // A company deleted elsewhere keeps its row here, so the Owner can still see and delete it.
    { $lookup: { from: Company.collection.name, localField: "companyId", foreignField: "_id", as: "company", pipeline: [{ $project: COMPANY_PROJECTION }] } },
    { $unwind: { path: "$company", preserveNullAndEmptyArrays: true } },
    effectiveStage,
  ];
  if (q?.q) pipeline.push(searchMatch(q.q));
  const page = q?.page ?? 1;
  const pageSize = q?.pageSize ?? 1;
  pipeline.push({ $sort: { sentAt: -1, _id: 1 } }, { $facet: { items: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }], total: [{ $count: "n" }] } });
  const [res] = await LeadAssignment.aggregate<{ items: (LeadAssignmentDoc & { company?: CompanyDoc; eff: Effective; details?: Details })[]; total: { n: number }[] }>(pipeline);
  const items = res?.items ?? [];
  const userIds = new Set<string>();
  for (const a of items) {
    if (a.outreachStatusBy) userIds.add(String(a.outreachStatusBy));
    if (a.details?.editedBy) userIds.add(String(a.details.editedBy));
    for (const h of a.history ?? []) userIds.add(String(h.actorId));
  }
  const users = await User.find({ _id: { $in: [...userIds].map((id) => new Types.ObjectId(id)) } }).select("name email").lean<Pick<UserDoc, "_id" | "name" | "email">[]>();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const who = (id: unknown) => (id ? (byId.get(String(id))?.name ?? "Deleted user") : "—");
  const rows: OwnerLeadRow[] = items.map((a) => {
    const overridden = DETAIL_FIELDS.filter((f) => typeof a.details?.[f] === "string");
    return {
      ...shownFields(a.eff, a.company),
      id: String(a._id),
      companyId: String(a.companyId),
      countryCode: a.company?.countryCode ?? a.countryCode ?? undefined,
      sentAt: new Date(a.sentAt).toISOString(),
      status: a.status as "ACTIVE" | "WITHDRAWN",
      outreachStatus: (a.outreachStatus as OutreachStatus | undefined) ?? "NOT_REACHED",
      outreachStatusAt: a.outreachStatusAt ? new Date(a.outreachStatusAt).toISOString() : undefined,
      outreachStatusBy: a.outreachStatusBy ? who(a.outreachStatusBy) : undefined,
      original: originalOf(a.company),
      values: { companyName: a.eff.companyName ?? "", contactPerson: a.eff.contactPerson ?? "", contactRole: a.eff.contactRole ?? "", phone: a.eff.phone ?? "", website: a.eff.website ?? "" },
      edited: overridden.length && a.details?.editedAt ? { at: new Date(a.details.editedAt).toISOString(), by: who(a.details.editedBy), fields: overridden } : undefined,
      history: [...(a.history ?? [])].reverse().map((h) => ({
        action: h.action,
        at: new Date(h.at).toISOString(),
        by: who(h.actorId),
        outreachStatus: (h.outreachStatus as OutreachStatus | undefined) ?? undefined,
        previousOutreachStatus: (h.previousOutreachStatus as OutreachStatus | undefined) ?? undefined,
        fields: h.fields?.length ? h.fields : undefined,
      })),
    };
  });
  return { rows, total: res?.total[0]?.n ?? 0 };
}

export async function listLeadAssignments(actor: Actor, input: unknown) {
  assertOwnerTable(actor);
  const q = ownerLeadQuerySchema.parse(input);
  const match: Record<string, unknown> = {};
  if (q.status !== "ALL") match.status = q.status;
  if (q.outreach) match.outreachStatus = q.outreach === "NOT_REACHED" ? { $in: [null, "NOT_REACHED"] } : q.outreach;
  const [{ rows, total }, marketers, counts] = await Promise.all([
    ownerRows(match, q),
    User.find({ role: "DIGITAL_MARKETER" }).select("name email status").sort({ name: 1 }).lean<Pick<UserDoc, "_id" | "name" | "email" | "status">[]>(),
    LeadAssignment.aggregate<{ _id: { s: string; o: OutreachStatus }; n: number }>([{ $match: TABLE_ROW }, { $group: { _id: { s: "$status", o: { $ifNull: ["$outreachStatus", "NOT_REACHED"] } }, n: { $sum: 1 } } }]),
  ]);
  const stats = { total: 0, active: 0, withdrawn: 0, NOT_REACHED: 0, MESSAGED: 0, GOT_RESPONSE: 0 };
  for (const c of counts) {
    stats.total += c.n;
    if (c._id.s === "ACTIVE") {
      stats.active += c.n;
      stats[c._id.o] += c.n;
    } else stats.withdrawn += c.n;
  }
  return {
    ...paginate(rows, total, q.page, q.pageSize),
    filters: { q: q.q ?? "", outreach: q.outreach ?? null, status: q.status },
    marketers: marketers.map((m) => ({ id: String(m._id), name: m.name, email: m.email, active: m.status === "ACTIVE" })),
    stats,
  };
}

const text = (max: number) => z.string().trim().max(max);
export const ownerLeadUpdateSchema = z
  .object({
    companyName: text(200).min(1, "Company name can't be empty"),
    contactPerson: text(200),
    contactRole: text(120),
    phone: text(40).refine((v) => v === "" || /^\+?[\d\s().\-/]{5,}$/.test(v), "Enter a valid phone number"),
    website: text(300).refine((v) => v === "" || !!safeExternalUrl(v), "Enter a valid website (https://…)"),
    outreachStatus: z.enum(OUTREACH_STATUSES),
    status: z.enum(LEAD_ASSIGNMENT_STATUSES),
  })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, "Nothing to update");

/**
 * Owner edit of one record. A detail equal to the Company value clears the correction; any other
 * value (an empty string = "remove") is stored on the assignment, never on the Company record.
 */
export async function updateLeadAssignment(actor: Actor, assignmentId: string, input: unknown) {
  assertOwnerTable(actor);
  const patch = ownerLeadUpdateSchema.parse(input);
  const id = parseObjectId(assignmentId);
  const a = await LeadAssignment.findOne({ _id: id, ...TABLE_ROW }).lean<LeadAssignmentDoc & { details?: Details }>();
  if (!a) throw Errors.notFound("Lead not found");
  const original = originalOf(await Company.findById(a.companyId).select("companyName contactPerson phone mobile website").lean<CompanyDoc>());
  const now = new Date();
  const me = new Types.ObjectId(actor.id);
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, 1> = {};
  const history: Record<string, unknown>[] = [];
  const changed: DetailField[] = [];
  for (const f of DETAIL_FIELDS) {
    const v = patch[f];
    if (v === undefined || v === (a.details?.[f] ?? original[f] ?? "")) continue;
    changed.push(f);
    if (v === (original[f] ?? "")) $unset[`details.${f}`] = 1;
    else $set[`details.${f}`] = v;
  }
  if (changed.length) {
    $set["details.editedAt"] = now;
    $set["details.editedBy"] = me;
    history.push({ action: "EDITED", actorId: me, at: now, fields: changed });
  }
  const previousOutreachStatus = (a.outreachStatus as OutreachStatus | undefined) ?? "NOT_REACHED";
  if (patch.outreachStatus && patch.outreachStatus !== previousOutreachStatus) {
    Object.assign($set, { outreachStatus: patch.outreachStatus, outreachStatusAt: now, outreachStatusBy: me });
    history.push({ action: "OUTREACH", actorId: me, at: now, outreachStatus: patch.outreachStatus, previousOutreachStatus });
  }
  if (patch.status && patch.status !== a.status) {
    $set.status = patch.status;
    if (patch.status === "WITHDRAWN") $set.withdrawnAt = now;
    else $unset.withdrawnAt = 1;
    history.push({ action: patch.status === "WITHDRAWN" ? "WITHDRAWN" : "RESENT", actorId: me, at: now });
  }
  if (history.length) {
    await LeadAssignment.updateOne({ _id: id }, { ...(Object.keys($set).length && { $set }), ...(Object.keys($unset).length && { $unset }), $push: { history: { $each: history } } });
    await audit(actor, "lead.assignment_updated", {
      entityType: "LeadAssignment",
      entityId: String(id),
      countryCode: a.countryCode ?? undefined,
      metadata: { companyId: String(a.companyId), fields: changed, ...(patch.outreachStatus && { outreachStatus: patch.outreachStatus, previousOutreachStatus }), ...(patch.status && { status: patch.status }) },
    });
  }
  return (await ownerRows({ _id: id })).rows[0]!;
}

/** Owner: permanently delete one record from the Digital Marketer table (the Company record stays). */
export async function deleteLeadAssignment(actor: Actor, assignmentId: string) {
  assertOwnerTable(actor);
  const a = await LeadAssignment.findOneAndDelete({ _id: parseObjectId(assignmentId), ...TABLE_ROW }).lean<LeadAssignmentDoc>();
  if (!a) throw Errors.notFound("Lead not found");
  await CrmActivity.create({ companyId: a.companyId, countryCode: a.countryCode, type: "ASSIGNMENT", body: "Removed from the Digital Marketer table", actorId: actor.id, meta: { leadAssignmentId: String(a._id) } });
  await audit(actor, "lead.assignment_deleted", {
    entityType: "LeadAssignment",
    entityId: String(a._id),
    countryCode: a.countryCode ?? undefined,
    metadata: { companyId: String(a.companyId), status: a.status, outreachStatus: a.outreachStatus ?? "NOT_REACHED", details: a.details, historyEntries: a.history?.length ?? 0 },
  });
  return { ok: true, id: String(a._id) };
}
