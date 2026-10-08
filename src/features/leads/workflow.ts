import "server-only";
import { Types } from "mongoose";
import { z } from "zod";
import { Company, Contact, CrmActivity, FollowUp, SuppressionEntry, type CompanyDoc, type ContactDoc } from "@/models";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { ELIGIBILITY_STATES } from "@/lib/company-fields";
import { can, isInternal, type Actor } from "@/lib/permissions";
import { parseObjectId } from "@/lib/validation";
import { canManageLead } from "@/features/companies/service";
import { recomputeCompanyContacts } from "@/features/research/contacts";
import { checkSuppression } from "@/features/outreach/suppression";

/**
 * Manual lead workflow: outreach eligibility review, contact review queue and
 * manual contact logging. Nothing here sends anything.
 *
 * Eligibility is separate from availability: a published contact does not by
 * itself authorise marketing. Unclear cases stay "Needs review".
 */

async function loadCompany(actor: Actor, id: string) {
  if (!isInternal(actor) || !can(actor, "companies.read")) throw Errors.forbidden();
  const c = await Company.findById(parseObjectId(id)).lean<CompanyDoc>();
  if (!c) throw Errors.notFound();
  return c;
}

const eligibilitySchema = z.object({
  status: z.enum(ELIGIBILITY_STATES),
  reason: z.string().trim().min(3, "Give a short reason").max(500),
  /** Objection / erasure: also suppress the company's email addresses. */
  suppress: z.boolean().optional(),
});

export async function setEligibility(actor: Actor, companyId: string, input: unknown) {
  const c = await loadCompany(actor, companyId);
  if (!canManageLead(actor, c)) throw Errors.forbidden("Only the assigned owner or a lead manager can review outreach eligibility.");
  const d = eligibilitySchema.parse(input);
  if (d.status === "CLEARED") {
    if (c.marketingProtected) throw Errors.badRequest("The registry marks this company as protected from marketing — it cannot be cleared.");
    if (c.email && (await checkSuppression(c.email)).suppressed) throw Errors.badRequest("The company email is on the suppression list.");
  }
  await Company.updateOne({ _id: c._id }, { $set: { eligibility: { status: d.status, reason: d.reason, at: new Date(), by: new Types.ObjectId(actor.id) } } });
  if (d.status === "DO_NOT_CONTACT" || d.suppress) {
    const emails = (await Contact.find({ companyId: c._id, type: "EMAIL" }).select("value").lean<{ value: string }[]>()).map((x) => x.value);
    for (const email of [...new Set([c.email, ...emails].filter(Boolean) as string[])]) {
      await SuppressionEntry.updateOne({ email }, { $setOnInsert: { email, reason: "DO_NOT_CONTACT", source: "eligibility-review", note: d.reason, createdBy: actor.id } }, { upsert: true });
    }
  }
  await CrmActivity.create({ companyId: c._id, countryCode: c.countryCode, type: "SYSTEM", body: `Outreach eligibility: ${d.status.replace(/_/g, " ").toLowerCase()} — ${d.reason}`, actorId: actor.id });
  await audit(actor, "eligibility.set", { entityType: "Company", entityId: companyId, countryCode: c.countryCode, metadata: { status: d.status, suppress: !!d.suppress } });
  return { ok: true };
}

const reviewSchema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), note: z.string().trim().max(500).optional(), ownership: z.enum(["CONFIRMED", "LIKELY", "GROUP_LEVEL", "INTERMEDIARY"]).optional() });

/** Approve or reject an ambiguous contact (review queue). Approval is a human decision, never a score. */
export async function reviewContact(actor: Actor, contactId: string, input: unknown) {
  if (!isInternal(actor) || !(can(actor, "companies.edit") || can(actor, "leads.manage"))) throw Errors.forbidden();
  const d = reviewSchema.parse(input);
  const contact = await Contact.findById(parseObjectId(contactId)).lean<ContactDoc>();
  if (!contact) throw Errors.notFound();
  await Contact.updateOne(
    { _id: contact._id },
    {
      $set: {
        review: d.decision,
        reviewNote: d.note,
        reviewedBy: new Types.ObjectId(actor.id),
        reviewedAt: new Date(),
        ...(d.ownership && { ownership: d.ownership }),
        ...(d.decision === "APPROVED" && !d.ownership && contact.ownership === "UNCERTAIN" && { ownership: "LIKELY" }),
      },
    },
  );
  const r = await recomputeCompanyContacts(contact.companyId);
  await CrmActivity.create({ companyId: contact.companyId, countryCode: contact.countryCode, type: "SYSTEM", body: `Contact ${contact.value} ${d.decision === "APPROVED" ? "approved" : "rejected"}${d.note ? ` — ${d.note}` : ""}`, actorId: actor.id });
  await audit(actor, "contact.reviewed", { entityType: "Contact", entityId: contactId, metadata: d });
  return { ok: true, directContact: r.has };
}

export async function listReviewQueue(actor: Actor, opts: { country?: string; limit?: number } = {}) {
  if (!isInternal(actor) || !can(actor, "companies.read")) throw Errors.forbidden();
  return Contact.find({ review: "PENDING", ...(opts.country && opts.country !== "ALL" && { countryCode: opts.country.toUpperCase() }) })
    .sort({ createdAt: -1 })
    .limit(opts.limit ?? 100)
    .populate("companyId", "companyName countryCode registrationNumber registrationDay website")
    .lean<(ContactDoc & { companyId: { _id: Types.ObjectId; companyName: string; countryCode: string; registrationNumber?: string; registrationDay?: string; website?: string } | null })[]>();
}

const contactLogSchema = z.object({
  channel: z.enum(["PHONE", "EMAIL", "MEETING", "CONTACT_FORM", "LINKEDIN", "OTHER"]),
  at: z.coerce.date().default(() => new Date()),
  outcome: z.enum(["NO_ANSWER", "LEFT_MESSAGE", "SPOKE", "SENT", "REPLIED", "NOT_INTERESTED", "MEETING_BOOKED", "OTHER"]),
  response: z.string().trim().max(2000).optional(),
  nextAction: z.string().trim().max(300).optional(),
  nextActionAt: z.coerce.date().optional(),
  /** A phone-only lead may give an email during the call — recorded as a manual contact. */
  providedEmail: z.union([z.email(), z.literal("")]).optional(),
});

/** Record a manual contact attempt: channel, date, response, next action, staff member. */
export async function logContactAttempt(actor: Actor, companyId: string, input: unknown) {
  const c = await loadCompany(actor, companyId);
  if (!canManageLead(actor, c)) throw Errors.forbidden("This lead is assigned to someone else.");
  const d = contactLogSchema.parse(input);
  await CrmActivity.create({
    companyId: c._id,
    countryCode: c.countryCode,
    type: "CONTACT_ATTEMPT",
    body: [`${d.channel.replace("_", " ").toLowerCase()} · ${d.outcome.replace(/_/g, " ").toLowerCase()}`, d.response, d.nextAction ? `Next: ${d.nextAction}` : null].filter(Boolean).join("\n"),
    meta: { channel: d.channel, outcome: d.outcome, at: d.at, nextAction: d.nextAction, nextActionAt: d.nextActionAt },
    actorId: actor.id,
  });
  const set: Record<string, unknown> = { "lead.lastContactedAt": d.at };
  const stage = c.lead?.stage ?? "NEW";
  if (["NEW", "RESEARCHING", "CONTACT_AVAILABLE", "QUALIFIED", "QUOTATION_DRAFTED", "READY_FOR_OUTREACH"].includes(stage) && ["SPOKE", "SENT", "LEFT_MESSAGE", "REPLIED", "MEETING_BOOKED"].includes(d.outcome)) {
    set["lead.stage"] = d.outcome === "REPLIED" ? "REPLIED" : d.outcome === "MEETING_BOOKED" ? "MEETING" : "CONTACTED";
    set["lead.stageChangedAt"] = new Date();
  }
  if (d.outcome === "NOT_INTERESTED") set["lead.stage"] = "NOT_INTERESTED";
  await Company.updateOne({ _id: c._id }, { $set: set });
  if (d.nextActionAt) {
    await FollowUp.create({ companyId: c._id, countryCode: c.countryCode, dueAt: d.nextActionAt, type: d.channel === "PHONE" ? "CALL" : d.channel === "MEETING" ? "MEETING" : "EMAIL", assignedTo: c.lead?.assignedTo ?? actor.id, notes: d.nextAction, createdBy: actor.id });
    const next = await FollowUp.findOne({ companyId: c._id, status: "OPEN" }).sort({ dueAt: 1 }).select("dueAt").lean<{ dueAt: Date }>();
    await Company.updateOne({ _id: c._id }, { $set: { "lead.nextFollowUpAt": next?.dueAt } });
  }
  if (d.providedEmail) {
    const { recordContact } = await import("@/features/research/contacts");
    await recordContact(c, { type: "EMAIL", value: d.providedEmail.toLowerCase(), sourceKind: "MANUAL", source: `Provided during ${d.channel.toLowerCase()} (${actor.name})`, ownership: "CONFIRMED", evidence: [{ kind: "MANUAL", detail: `Given by the company on ${d.at.toISOString().slice(0, 10)}` }] });
    await recomputeCompanyContacts(c._id);
  }
  await audit(actor, "crm.contact_logged", { entityType: "Company", entityId: companyId, countryCode: c.countryCode, metadata: { channel: d.channel, outcome: d.outcome } });
  return { ok: true };
}
