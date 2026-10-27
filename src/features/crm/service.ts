import { Types, type FilterQuery } from "mongoose";
import { z } from "zod";
import { FOLLOW_UP_TYPES, LEAD_STAGES, LEAD_STAGE_LABELS, PIPELINE_STAGES, type LeadStage } from "@/lib/constants";
import { Company, CrmActivity, FollowUp, Organization, SuppressionEntry, User, type CompanyDoc, type FollowUpDoc } from "@/models";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { can, type Actor } from "@/lib/permissions";
import { objectId, parseObjectId } from "@/lib/validation";
import { slugify } from "@/lib/utils";
import { notifyUsers } from "@/features/notifications/service";
import { assertCanReadCompanies, canManageLead, countryFilter } from "@/features/companies/service";

async function loadManageableCompany(actor: Actor, companyId: string) {
  assertCanReadCompanies(actor);
  const company = await Company.findById(parseObjectId(companyId)).lean<CompanyDoc>();
  if (!company) throw Errors.notFound();
  if (!canManageLead(actor, company)) throw Errors.forbidden("This lead is assigned to someone else.");
  return company;
}

async function logActivity(actor: Actor | null, company: Pick<CompanyDoc, "_id" | "countryCode">, type: string, body?: string, meta?: Record<string, unknown>) {
  await CrmActivity.create({ companyId: company._id, countryCode: company.countryCode, type, body, meta, actorId: actor?.id });
}

export const stageSchema = z.object({ stage: z.enum(LEAD_STAGES), note: z.string().trim().max(2000).optional() });

export async function changeStage(actor: Actor, companyId: string, input: unknown) {
  const { stage, note } = stageSchema.parse(input);
  const company = await loadManageableCompany(actor, companyId);
  const from = (company.lead?.stage ?? "NEW") as LeadStage;
  if (from === stage) return company;
  const now = new Date();
  const set: Record<string, unknown> = { "lead.stage": stage, "lead.stageChangedAt": now };
  if (stage === "QUALIFIED" && !company.lead?.qualifiedAt) set["lead.qualifiedAt"] = now;
  if (stage === "CONTACTED") set["lead.lastContactedAt"] = now;
  if (stage === "DO_NOT_CONTACT") Object.assign(set, { "eligibility.status": "DO_NOT_CONTACT", "eligibility.reason": note || "Marked Do not contact in the CRM", "eligibility.at": now, "eligibility.by": actor.id });
  await Company.updateOne({ _id: company._id }, { $set: set });

  if (stage === "DO_NOT_CONTACT" && company.email) {
    await SuppressionEntry.updateOne(
      { email: company.email },
      { $setOnInsert: { email: company.email, reason: "DO_NOT_CONTACT", source: "crm", createdBy: actor.id } },
      { upsert: true },
    );
  }
  await logActivity(actor, company, "STAGE_CHANGE", note, { from, to: stage });
  await audit(actor, "crm.stage_changed", { entityType: "Company", entityId: companyId, countryCode: company.countryCode, metadata: { from, to: stage } });

  const assignee = company.lead?.assignedTo ? String(company.lead.assignedTo) : null;
  if (assignee && assignee !== actor.id && (stage === "REPLIED" || stage === "MEETING")) {
    await notifyUsers([assignee], {
      type: stage === "REPLIED" ? "REPLY" : "MEETING",
      title: `${company.companyName}: ${LEAD_STAGE_LABELS[stage]}`,
      link: `/dashboard/companies/${company.countryCode.toLowerCase()}/${companyId}`,
    });
  }
  return { ...company, lead: { ...company.lead, stage } };
}

export async function assignLead(actor: Actor, companyId: string, input: unknown) {
  if (!can(actor, "leads.manage")) throw Errors.forbidden();
  const { userId } = z.object({ userId: objectId.nullable() }).parse(input);
  const company = await Company.findById(parseObjectId(companyId)).lean<CompanyDoc>();
  if (!company) throw Errors.notFound();
  let assigneeName = "Unassigned";
  if (userId) {
    const user = await User.findOne({ _id: userId, role: { $in: ["OWNER", "ADMIN", "MANAGER", "STAFF"] }, status: "ACTIVE" }).select("name").lean<{ name: string }>();
    if (!user) throw Errors.badRequest("Assignee must be an active internal user.");
    assigneeName = user.name;
  }
  await Company.updateOne({ _id: company._id }, userId ? { $set: { "lead.assignedTo": userId } } : { $unset: { "lead.assignedTo": 1 } });
  await logActivity(actor, company, "ASSIGNMENT", `Assigned to ${assigneeName}`, { userId });
  await audit(actor, "crm.assigned", { entityType: "Company", entityId: companyId, countryCode: company.countryCode, metadata: { userId } });
  if (userId && userId !== actor.id) {
    await notifyUsers([userId], { type: "SYSTEM", title: `Lead assigned: ${company.companyName}`, link: `/dashboard/companies/${company.countryCode.toLowerCase()}/${companyId}` });
  }
}

export const activitySchema = z.object({
  type: z.enum(["NOTE", "CALL", "EMAIL", "MEETING", "TASK"]),
  body: z.string().trim().min(1, "Write something").max(5000),
});

export async function addActivity(actor: Actor, companyId: string, input: unknown) {
  const data = activitySchema.parse(input);
  const company = await loadManageableCompany(actor, companyId);
  await logActivity(actor, company, data.type, data.body);
  if (data.type === "CALL" || data.type === "EMAIL" || data.type === "MEETING") {
    await Company.updateOne({ _id: company._id }, { $set: { "lead.lastContactedAt": new Date() } });
  }
}

export const followUpSchema = z.object({
  dueAt: z.coerce.date(),
  type: z.enum(FOLLOW_UP_TYPES).default("EMAIL"),
  notes: z.string().trim().max(2000).optional(),
  assignedTo: objectId.optional(),
  reminder: z.boolean().default(true),
});

async function refreshNextFollowUp(companyId: Types.ObjectId) {
  const next = await FollowUp.findOne({ companyId, status: "OPEN" }).sort({ dueAt: 1 }).select("dueAt").lean<{ dueAt: Date }>();
  await Company.updateOne({ _id: companyId }, next ? { $set: { "lead.nextFollowUpAt": next.dueAt } } : { $unset: { "lead.nextFollowUpAt": 1 } });
}

export async function createFollowUp(actor: Actor, companyId: string, input: unknown) {
  const data = followUpSchema.parse(input);
  const company = await loadManageableCompany(actor, companyId);
  const assignedTo = data.assignedTo && can(actor, "leads.manage") ? data.assignedTo : (company.lead?.assignedTo ? String(company.lead.assignedTo) : actor.id);
  const fu = await FollowUp.create({ ...data, assignedTo, companyId: company._id, countryCode: company.countryCode, createdBy: actor.id });
  await refreshNextFollowUp(company._id);
  await logActivity(actor, company, "TASK", `Follow-up (${data.type.toLowerCase()}) scheduled for ${data.dueAt.toISOString().slice(0, 10)}${data.notes ? `: ${data.notes}` : ""}`);
  return fu;
}

export async function updateFollowUp(actor: Actor, followUpId: string, input: unknown) {
  const { status } = z.object({ status: z.enum(["OPEN", "DONE", "CANCELLED"]) }).parse(input);
  const fu = await FollowUp.findById(parseObjectId(followUpId)).lean<FollowUpDoc>();
  if (!fu) throw Errors.notFound();
  await loadManageableCompany(actor, String(fu.companyId));
  await FollowUp.updateOne({ _id: fu._id }, { $set: { status, completedAt: status === "DONE" ? new Date() : undefined } });
  await refreshNextFollowUp(fu.companyId);
}

/** Follow-ups visible to the actor: everything with leads.manage, otherwise only their own. */
export async function listFollowUps(actor: Actor, opts: { country: string; bucket: "today" | "overdue" | "upcoming"; limit?: number }) {
  assertCanReadCompanies(actor);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const filter: FilterQuery<FollowUpDoc> = { status: "OPEN", ...countryFilter(opts.country) };
  if (!can(actor, "leads.manage")) filter.assignedTo = new Types.ObjectId(actor.id);
  filter.dueAt = opts.bucket === "today" ? { $gte: today, $lt: tomorrow } : opts.bucket === "overdue" ? { $lt: today } : { $gte: tomorrow };
  return FollowUp.find(filter)
    .sort({ dueAt: opts.bucket === "overdue" ? -1 : 1 })
    .limit(opts.limit ?? 50)
    .populate("companyId", "companyName countryCode lead.stage lead.score")
    .populate("assignedTo", "name")
    .lean();
}

/** Create FOLLOW_UP_DUE notifications once per follow-up due today or overdue. */
export async function dispatchDueFollowUpReminders() {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const due = await FollowUp.find({ status: "OPEN", reminder: true, reminderSentAt: null, dueAt: { $lte: end } })
    .limit(200)
    .populate("companyId", "companyName countryCode")
    .lean<(FollowUpDoc & { companyId: { _id: Types.ObjectId; companyName: string; countryCode: string } | null })[]>();
  for (const fu of due) {
    if (fu.assignedTo && fu.companyId) {
      await notifyUsers([String(fu.assignedTo)], {
        type: "FOLLOW_UP_DUE",
        title: `Follow-up due: ${fu.companyId.companyName}`,
        body: fu.notes ?? undefined,
        link: `/dashboard/companies/${fu.companyId.countryCode.toLowerCase()}/${fu.companyId._id}`,
        groupKey: `followup:${fu._id}`,
      });
    }
    await FollowUp.updateOne({ _id: fu._id }, { $set: { reminderSentAt: new Date() } });
  }
  return due.length;
}

/** Kanban pipeline: per-stage counts plus the top leads in each column. */
export async function getPipeline(actor: Actor, country: string, opts: { mine?: boolean; perStage?: number } = {}) {
  assertCanReadCompanies(actor);
  const base: FilterQuery<CompanyDoc> = { ...countryFilter(country), "lead.stage": { $ne: "NEW" } };
  if (opts.mine || !can(actor, "leads.manage")) base["lead.assignedTo"] = new Types.ObjectId(actor.id);
  const stages = [...PIPELINE_STAGES.filter((s) => s !== "NEW"), "NOT_INTERESTED", "DO_NOT_CONTACT"] as LeadStage[];
  const counts = await Company.aggregate([{ $match: base }, { $group: { _id: "$lead.stage", n: { $sum: 1 } } }]);
  const countMap = new Map(counts.map((c: { _id: string; n: number }) => [c._id, c.n]));
  const columns = await Promise.all(
    stages.map(async (stage) => ({
      stage,
      label: LEAD_STAGE_LABELS[stage],
      count: countMap.get(stage) ?? 0,
      items: await Company.find({ ...base, "lead.stage": stage })
        .select("companyName countryCode city industry lead.score lead.stage lead.assignedTo lead.nextFollowUpAt email website isDemo")
        .sort({ "lead.score": -1 })
        .limit(opts.perStage ?? 20)
        .lean<CompanyDoc[]>(),
    })),
  );
  return columns;
}

/** Won lead → client organization (linked to the intelligence record). */
export async function convertToClient(actor: Actor, companyId: string) {
  if (!can(actor, "clients.manage")) throw Errors.forbidden();
  const company = await Company.findById(parseObjectId(companyId)).lean<CompanyDoc>();
  if (!company) throw Errors.notFound();
  if (company.lead?.organizationId) return Organization.findById(company.lead.organizationId).lean();
  const org = await Organization.create({
    name: company.companyName,
    slug: `${slugify(company.companyName)}-${company._id.toString().slice(-6)}`,
    countryCode: company.countryCode,
    website: company.website,
    industry: company.industry,
    phone: company.phone,
    email: company.email,
    status: "ACTIVE",
    companyId: company._id,
    accountManagerId: company.lead?.assignedTo ?? actor.id,
    isDemo: company.isDemo,
  });
  await Company.updateOne({ _id: company._id }, { $set: { "lead.stage": "CLIENT", "lead.organizationId": org._id, "lead.stageChangedAt": new Date() } });
  await logActivity(actor, company, "STAGE_CHANGE", "Converted to client", { to: "CLIENT", organizationId: String(org._id) });
  await audit(actor, "client.created_from_lead", { entityType: "Organization", entityId: String(org._id), countryCode: company.countryCode, organizationId: String(org._id) });
  return org.toObject();
}

export async function listInternalUsers() {
  return User.find({ role: { $in: ["OWNER", "ADMIN", "MANAGER", "STAFF"] }, status: "ACTIVE" }).select("name email role").sort({ name: 1 }).lean<{ _id: Types.ObjectId; name: string; email: string; role: string }[]>();
}

