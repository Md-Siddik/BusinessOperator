import { Types, type FilterQuery } from "mongoose";
import { z } from "zod";
import { COUNTRY_CODES, countryName } from "@/config/countries";
import { INDUSTRIES } from "@/config/industries";
import { LANGUAGE_CODES } from "@/config/languages";
import { SERVICE_SLUGS } from "@/config/services";
import { CAMPAIGN_STATUSES, EMAIL_STATUSES, LEAD_STAGES, stagesFrom } from "@/lib/constants";
import {
  Company,
  Contact,
  CrmActivity,
  EmailCampaign,
  EmailMessage,
  EmailTemplate,
  type CompanyDoc,
  type EmailCampaignDoc,
  type EmailMessageDoc,
  type EmailTemplateDoc,
} from "@/models";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { can, type Actor } from "@/lib/permissions";
import { paginate, parseObjectId } from "@/lib/validation";
import { formatDate } from "@/lib/utils/format";
import { getEmailProvider } from "@/lib/email/provider";
import { renderTemplate, textToHtml, type TemplateVariables } from "@/lib/email/render";
import { unsubscribeApiUrl, unsubscribeUrl } from "@/lib/email/unsubscribe";
import { getBaseMessages } from "@/lib/i18n/dictionaries";
import { getPath } from "@/lib/i18n/translator";
import { getSetting } from "@/features/settings/service";
import { notifyUsers } from "@/features/notifications/service";
import { assertCanReadCompanies } from "@/features/companies/service";
import { companyVisibilityFilter } from "@/lib/data-mode";
import { checkSuppression } from "./suppression";

function requireOutreach(actor: Actor) {
  if (!can(actor, "outreach.manage")) throw Errors.forbidden();
}
function requireApprover(actor: Actor) {
  if (!can(actor, "outreach.approve")) throw Errors.forbidden("Only approvers can approve or send outreach.");
}

/* ───────────── Templates ───────────── */

export const templateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  subject: z.string().trim().min(2).max(300),
  body: z.string().trim().min(10).max(20_000),
  countryCode: z.string().refine((v) => v === "INTL" || COUNTRY_CODES.includes(v), "Invalid country"),
  languageCode: z.enum(LANGUAGE_CODES as [string, ...string[]]),
  industry: z.enum(INDUSTRIES).optional().or(z.literal("").transform(() => undefined)),
  serviceCategory: z.enum(SERVICE_SLUGS as [string, ...string[]]).optional().or(z.literal("").transform(() => undefined)),
  active: z.boolean().default(true),
});

export async function listTemplates(actor: Actor, opts: { country?: string } = {}) {
  requireOutreach(actor);
  const filter: FilterQuery<EmailTemplateDoc> = {};
  if (opts.country && opts.country !== "ALL") filter.countryCode = { $in: [opts.country.toUpperCase(), "INTL"] };
  return EmailTemplate.find(filter).sort({ countryCode: 1, languageCode: 1, name: 1 }).lean<EmailTemplateDoc[]>();
}

export async function getTemplate(actor: Actor, id: string) {
  requireOutreach(actor);
  const t = await EmailTemplate.findById(parseObjectId(id)).lean<EmailTemplateDoc>();
  if (!t) throw Errors.notFound();
  return t;
}

export async function saveTemplate(actor: Actor, id: string | null, input: unknown) {
  requireOutreach(actor);
  const data = templateSchema.parse(input);
  const doc = id
    ? await EmailTemplate.findByIdAndUpdate(parseObjectId(id), { $set: data }, { new: true }).lean<EmailTemplateDoc>()
    : (await EmailTemplate.create({ ...data, createdBy: actor.id })).toObject();
  if (!doc) throw Errors.notFound();
  await audit(actor, id ? "template.updated" : "template.created", { entityType: "EmailTemplate", entityId: String(doc._id) });
  return doc;
}

export async function deleteTemplate(actor: Actor, id: string) {
  requireOutreach(actor);
  const inUse = await EmailCampaign.exists({ templateId: parseObjectId(id) });
  if (inUse) throw Errors.conflict("This template is used by a campaign. Deactivate it instead.");
  await EmailTemplate.deleteOne({ _id: parseObjectId(id) });
  await audit(actor, "template.deleted", { entityType: "EmailTemplate", entityId: id });
}

/* ───────────── Personalisation ───────────── */

/** Variables come only from stored facts. Missing facts stay empty and are reported to the reviewer. */
export async function personalizationFor(company: CompanyDoc, languageCode: string): Promise<TemplateVariables> {
  const outreach = await getSetting("outreach");
  const person = company.contactPerson?.name ? company.contactPerson : await Contact.findOne({ companyId: company._id, type: "CONTACT_PERSON" }).sort({ createdAt: 1 }).lean<{ value?: string }>().then((c) => (c?.value ? { name: c.value } : null));
  const industryLabel = getPath(getBaseMessages(languageCode), `industries.${company.industry ?? "other"}`) as string | undefined;
  return {
    companyName: company.companyName,
    contactName: person?.name ?? undefined,
    industry: company.industry && company.industry !== "other" ? industryLabel?.toLowerCase() : undefined,
    country: countryName(company.countryCode),
    website: company.website?.replace(/^https?:\/\//, ""),
    registrationDate: company.registrationDate ? formatDate(company.registrationDate) : undefined,
    city: company.city,
    senderName: outreach.senderName,
  };
}

async function draftFromTemplate(actor: Actor, company: CompanyDoc, template: EmailTemplateDoc, campaignId?: Types.ObjectId) {
  if (!company.email) return { skipped: "no-email" as const };
  if (company.marketingProtected) return { skipped: "protected" as const };
  // Availability is not permission: drafting requires a human eligibility review.
  if (company.eligibility?.status !== "CLEARED") return { skipped: "not-cleared" as const };
  if (["DO_NOT_CONTACT", "NOT_INTERESTED", "CLIENT"].includes(company.lead?.stage ?? "")) return { skipped: "stage" as const };
  const suppression = await checkSuppression(company.email);
  if (suppression.suppressed) return { skipped: "suppressed" as const };
  if (campaignId && (await EmailMessage.exists({ campaignId, companyId: company._id }))) return { skipped: "exists" as const };

  const vars = await personalizationFor(company, template.languageCode);
  const subject = renderTemplate(template.subject, vars);
  const body = renderTemplate(template.body, vars);
  const outreach = await getSetting("outreach");
  const msg = await EmailMessage.create({
    kind: "OUTREACH",
    campaignId,
    companyId: company._id,
    templateId: template._id,
    countryCode: company.countryCode,
    languageCode: template.languageCode,
    to: company.email,
    toName: vars.contactName ?? undefined,
    from: outreach.senderEmail,
    subject: subject.output,
    body: body.output,
    personalization: { variables: vars, missing: [...new Set([...subject.missing, ...body.missing])] },
    contactSource: company.isDemo ? "Demo data" : `${company.contactSources?.email?.kind === "WEBSITE" ? "Company website" : company.contactSources?.email?.kind === "MANUAL" ? "Added manually" : "Official registry"} (${company.contactSources?.email?.source ?? company.sourceName ?? company.source})`,
    status: "DRAFT",
    createdBy: actor.id,
    isDemo: company.isDemo,
  });
  return { message: msg.toObject() };
}

export async function createDraftForCompany(actor: Actor, input: unknown) {
  requireOutreach(actor);
  const { companyId, templateId } = z.object({ companyId: z.string(), templateId: z.string() }).parse(input);
  assertCanReadCompanies(actor);
  const [company, template] = await Promise.all([
    Company.findById(parseObjectId(companyId)).lean<CompanyDoc>(),
    EmailTemplate.findById(parseObjectId(templateId)).lean<EmailTemplateDoc>(),
  ]);
  if (!company || !template) throw Errors.notFound();
  const res = await draftFromTemplate(actor, company, template);
  if ("skipped" in res) {
    const reasons = { "not-cleared": "Outreach eligibility has not been cleared for this company (review it on the company profile first).", protected: "The registry marks this company as protected from marketing.", "no-email": "This company has no email address.", stage: "This lead's stage doesn't allow outreach.", suppressed: "This address is on the suppression list.", exists: "A draft already exists." };
    throw Errors.badRequest(reasons[res.skipped!]);
  }
  return res.message;
}

/* ───────────── Campaigns ───────────── */

export const campaignSchema = z.object({
  name: z.string().trim().min(2).max(120),
  countryCode: z.string().refine((v) => COUNTRY_CODES.includes(v), "Campaigns are always country-specific"),
  languageCode: z.enum(LANGUAGE_CODES as [string, ...string[]]),
  industry: z.enum(INDUSTRIES).optional().or(z.literal("").transform(() => undefined)),
  templateId: z.string().refine((v) => Types.ObjectId.isValid(v), "Choose a template"),
  status: z.enum(CAMPAIGN_STATUSES).default("DRAFT"),
  segment: z
    .object({
      minScore: z.coerce.number().int().min(0).max(100).default(0),
      requireEmail: z.boolean().default(true),
      stages: z.array(z.enum(LEAD_STAGES)).min(1).default(["QUALIFIED", "READY_FOR_OUTREACH"]),
      registeredWithinDays: z.coerce.number().int().min(1).max(3650).optional(),
      noWebsiteOnly: z.boolean().default(false),
    })
    .default({ minScore: 0, requireEmail: true, stages: ["QUALIFIED", "READY_FOR_OUTREACH"], noWebsiteOnly: false }),
});

function campaignTargetFilter(c: Pick<EmailCampaignDoc, "countryCode" | "industry" | "segment">): FilterQuery<CompanyDoc> {
  const f: FilterQuery<CompanyDoc> = { countryCode: c.countryCode, "lead.stage": { $in: c.segment?.stages ?? ["QUALIFIED"] }, marketingProtected: { $ne: true }, "eligibility.status": "CLEARED", ...companyVisibilityFilter() };
  if (c.industry) f.industry = c.industry;
  if (c.segment?.minScore) f["lead.score"] = { $gte: c.segment.minScore };
  if (c.segment?.requireEmail !== false) f.email = { $exists: true, $nin: [null, ""] };
  if (c.segment?.registeredWithinDays) f.registrationDate = { $gte: new Date(Date.now() - c.segment.registeredWithinDays * 86_400_000) };
  if (c.segment?.noWebsiteOnly) f.$or = [{ website: { $exists: false } }, { website: null }, { website: "" }];
  return f;
}

export async function listCampaigns(actor: Actor, opts: { country?: string } = {}) {
  requireOutreach(actor);
  const filter: FilterQuery<EmailCampaignDoc> = opts.country && opts.country !== "ALL" ? { countryCode: opts.country.toUpperCase() } : {};
  const campaigns = await EmailCampaign.find(filter).sort({ createdAt: -1 }).populate("templateId", "name").populate("createdBy", "name").lean<EmailCampaignDoc[]>();
  const stats = await EmailMessage.aggregate([
    { $match: { campaignId: { $in: campaigns.map((c) => c._id) } } },
    { $group: { _id: { c: "$campaignId", s: "$status" }, n: { $sum: 1 }, replies: { $sum: { $cond: [{ $eq: ["$replyStatus", "REPLIED"] }, 1, 0] } } } },
  ]);
  return campaigns.map((c) => {
    const rows = stats.filter((s) => String(s._id.c) === String(c._id));
    const by = (statuses: string[]) => rows.filter((r) => statuses.includes(r._id.s)).reduce((a, r) => a + r.n, 0);
    return {
      ...c,
      stats: {
        drafted: rows.reduce((a, r) => a + r.n, 0),
        pending: by(["PENDING_APPROVAL"]),
        approved: by(["APPROVED", "SENT", "DELIVERED"]),
        sent: by(["SENT", "DELIVERED"]),
        replies: rows.reduce((a, r) => a + r.replies, 0),
      },
    };
  });
}

export async function saveCampaign(actor: Actor, id: string | null, input: unknown) {
  requireOutreach(actor);
  const data = campaignSchema.parse(input);
  const template = await EmailTemplate.findById(data.templateId).lean<EmailTemplateDoc>();
  if (!template) throw Errors.badRequest("Template not found");
  const doc = id
    ? await EmailCampaign.findByIdAndUpdate(parseObjectId(id), { $set: data }, { new: true }).lean<EmailCampaignDoc>()
    : (await EmailCampaign.create({ ...data, createdBy: actor.id })).toObject();
  if (!doc) throw Errors.notFound();
  await audit(actor, id ? "campaign.updated" : "campaign.created", { entityType: "EmailCampaign", entityId: String(doc._id), countryCode: data.countryCode, metadata: { status: data.status } });
  return doc;
}

export async function setCampaignStatus(actor: Actor, id: string, input: unknown) {
  requireOutreach(actor);
  const { status } = z.object({ status: z.enum(CAMPAIGN_STATUSES) }).parse(input);
  const doc = await EmailCampaign.findByIdAndUpdate(parseObjectId(id), { $set: { status } }, { new: true }).lean<EmailCampaignDoc>();
  if (!doc) throw Errors.notFound();
  await audit(actor, "campaign.status_changed", { entityType: "EmailCampaign", entityId: id, countryCode: doc.countryCode, metadata: { status } });
  return doc;
}

export async function getCampaignDetail(actor: Actor, id: string) {
  requireOutreach(actor);
  const campaign = await EmailCampaign.findById(parseObjectId(id)).populate("templateId").populate("createdBy", "name").lean<EmailCampaignDoc & { templateId: EmailTemplateDoc | null }>();
  if (!campaign) throw Errors.notFound();
  const target = await Company.countDocuments(campaignTargetFilter(campaign));
  const messages = await EmailMessage.find({ campaignId: campaign._id }).select("status replyStatus companyId to subject createdAt sentAt").populate("companyId", "companyName lead.stage").sort({ createdAt: -1 }).limit(200).lean();
  const companyIds = messages.map((m) => (m.companyId as unknown as { _id: Types.ObjectId } | null)?._id).filter(Boolean);
  const stageCounts = await Company.aggregate([{ $match: { _id: { $in: companyIds } } }, { $group: { _id: "$lead.stage", n: { $sum: 1 } } }]);
  const atLeast = (stage: "MEETING" | "PROPOSAL" | "CLIENT") => stageCounts.filter((s) => stagesFrom(stage).includes(s._id)).reduce((a, s) => a + s.n, 0);
  const count = (statuses: string[]) => messages.filter((m) => statuses.includes(m.status)).length;
  return {
    campaign,
    messages,
    stats: {
      target,
      drafted: messages.length,
      approved: count(["APPROVED", "SENT", "DELIVERED"]),
      sent: count(["SENT", "DELIVERED"]),
      delivered: count(["DELIVERED"]),
      replies: messages.filter((m) => m.replyStatus === "REPLIED").length,
      meetings: atLeast("MEETING"),
      proposals: atLeast("PROPOSAL"),
      clients: atLeast("CLIENT"),
    },
  };
}

/** Human-in-the-loop: generates DRAFTS only — nothing is sent without review and approval. */
export async function generateCampaignDrafts(actor: Actor, id: string, input: unknown) {
  requireOutreach(actor);
  const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) }).parse(input ?? {});
  const campaign = await EmailCampaign.findById(parseObjectId(id)).lean<EmailCampaignDoc>();
  if (!campaign) throw Errors.notFound();
  if (campaign.status === "COMPLETED" || campaign.status === "PAUSED") throw Errors.badRequest("Activate the campaign first.");
  const template = await EmailTemplate.findById(campaign.templateId).lean<EmailTemplateDoc>();
  if (!template || !template.active) throw Errors.badRequest("The campaign template is missing or inactive.");
  const already = await EmailMessage.find({ campaignId: campaign._id }).distinct("companyId");
  const companies = await Company.find({ ...campaignTargetFilter(campaign), _id: { $nin: already } }).sort({ "lead.score": -1 }).limit(limit * 2).lean<CompanyDoc[]>();
  const result = { created: 0, skippedSuppressed: 0, skippedOther: 0 };
  for (const company of companies) {
    if (result.created >= limit) break;
    const res = await draftFromTemplate(actor, company, template, campaign._id);
    if ("message" in res) result.created++;
    else if (res.skipped === "suppressed") result.skippedSuppressed++;
    else result.skippedOther++;
  }
  await audit(actor, "campaign.drafts_generated", { entityType: "EmailCampaign", entityId: id, countryCode: campaign.countryCode, metadata: result });
  return result;
}

/* ───────────── Messages: review → approve → send ───────────── */

export async function listOutreachMessages(actor: Actor, opts: { country?: string; status?: string; campaignId?: string; page?: number }) {
  requireOutreach(actor);
  const page = opts.page ?? 1;
  const filter: FilterQuery<EmailMessageDoc> = { kind: "OUTREACH" };
  if (opts.country && opts.country !== "ALL") filter.countryCode = opts.country.toUpperCase();
  if (opts.status && (EMAIL_STATUSES as readonly string[]).includes(opts.status)) filter.status = opts.status;
  if (opts.status === "REPLIED") {
    delete filter.status;
    filter.replyStatus = "REPLIED";
  }
  if (opts.campaignId && Types.ObjectId.isValid(opts.campaignId)) filter.campaignId = new Types.ObjectId(opts.campaignId);
  const [items, total] = await Promise.all([
    EmailMessage.find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * 25)
      .limit(25)
      .populate("companyId", "companyName countryCode lead.stage")
      .populate("campaignId", "name")
      .populate("createdBy", "name")
      .populate("approvedBy", "name")
      .lean(),
    EmailMessage.countDocuments(filter),
  ]);
  return paginate(items, total, page, 25);
}

async function loadOutreachMessage(id: string) {
  const m = await EmailMessage.findOne({ _id: parseObjectId(id), kind: "OUTREACH" }).lean<EmailMessageDoc>();
  if (!m) throw Errors.notFound();
  return m;
}

export async function updateDraft(actor: Actor, id: string, input: unknown) {
  requireOutreach(actor);
  const data = z.object({ subject: z.string().trim().min(2).max(300), body: z.string().trim().min(10).max(20_000) }).parse(input);
  const m = await loadOutreachMessage(id);
  if (!["DRAFT", "REJECTED"].includes(m.status)) throw Errors.badRequest("Only drafts can be edited.");
  await EmailMessage.updateOne({ _id: m._id }, { $set: { ...data, status: "DRAFT" } });
}

export async function submitForReview(actor: Actor, id: string) {
  requireOutreach(actor);
  const m = await loadOutreachMessage(id);
  if (!["DRAFT", "REJECTED"].includes(m.status)) throw Errors.badRequest("Only drafts can be submitted.");
  await EmailMessage.updateOne({ _id: m._id }, { $set: { status: "PENDING_APPROVAL", submittedBy: actor.id } });
}

export async function approveMessage(actor: Actor, id: string) {
  requireApprover(actor);
  const settings = await getSetting("outreach");
  const m = await loadOutreachMessage(id);
  if (m.status !== "PENDING_APPROVAL") throw Errors.badRequest("Only messages awaiting review can be approved.");
  const author = String(m.submittedBy ?? m.createdBy ?? "");
  if (!settings.allowSelfApproval && author === actor.id && actor.role !== "OWNER") throw Errors.forbidden("A second person must approve messages you drafted.");
  const compliance = await checkSuppression(m.to);
  if (compliance.suppressed) {
    await EmailMessage.updateOne({ _id: m._id }, { $set: { status: "SUPPRESSED", compliance: { checkedAt: new Date(), suppressed: true, reason: compliance.reason } } });
    throw Errors.badRequest("This recipient is on the suppression list. The message was blocked.");
  }
  await EmailMessage.updateOne(
    { _id: m._id },
    { $set: { status: "APPROVED", approvedBy: actor.id, approvedAt: new Date(), compliance: { checkedAt: new Date(), suppressed: false } } },
  );
  await audit(actor, "email.approved", { entityType: "EmailMessage", entityId: id, countryCode: m.countryCode ?? undefined });
}

export async function rejectMessage(actor: Actor, id: string, input: unknown) {
  requireApprover(actor);
  const { reason } = z.object({ reason: z.string().trim().min(2).max(500) }).parse(input);
  const m = await loadOutreachMessage(id);
  if (m.status !== "PENDING_APPROVAL") throw Errors.badRequest("Only messages awaiting review can be rejected.");
  await EmailMessage.updateOne({ _id: m._id }, { $set: { status: "REJECTED", rejectedReason: reason } });
  await audit(actor, "email.rejected", { entityType: "EmailMessage", entityId: id });
  if (m.createdBy && String(m.createdBy) !== actor.id) {
    await notifyUsers([String(m.createdBy)], { type: "SYSTEM", title: "Outreach draft returned for changes", body: reason, link: "/dashboard/outreach/history?status=REJECTED" });
  }
}

export async function sendApprovedMessage(actor: Actor, id: string) {
  requireApprover(actor);
  const settings = await getSetting("outreach");
  const m = await loadOutreachMessage(id);
  if (m.status !== "APPROVED") throw Errors.badRequest("Only approved messages can be sent.");

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const sentToday = await EmailMessage.countDocuments({ kind: "OUTREACH", status: { $in: ["SENT", "DELIVERED"] }, sentAt: { $gte: startOfDay } });
  if (sentToday >= settings.dailySendLimit) throw Errors.badRequest(`Daily send limit (${settings.dailySendLimit}) reached.`);

  // Re-check suppression at send time — an opt-out may have arrived after approval.
  const compliance = await checkSuppression(m.to);
  if (compliance.suppressed) {
    await EmailMessage.updateOne({ _id: m._id }, { $set: { status: "SUPPRESSED", compliance: { checkedAt: new Date(), suppressed: true, reason: compliance.reason } } });
    throw Errors.badRequest("This recipient opted out after approval. The message was blocked.");
  }

  const unsub = unsubscribeUrl(m.to);
  const footer = renderTemplate(settings.footer, { unsubscribeUrl: unsub }).output;
  const text = `${m.body}\n\n—\n${footer}${settings.postalAddress ? `\n${settings.postalAddress}` : ""}`;
  const provider = getEmailProvider();
  try {
    const result = await provider.send({
      to: m.to,
      toName: m.toName ?? undefined,
      from: settings.senderEmail,
      fromName: settings.senderName,
      subject: m.subject,
      text,
      html: textToHtml(text),
      headers: { "List-Unsubscribe": `<${unsubscribeApiUrl(m.to)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
    await EmailMessage.updateOne(
      { _id: m._id },
      { $set: { status: "SENT", sentAt: new Date(), provider: provider.id, providerMessageId: result.id, simulated: !provider.isLive } },
    );
  } catch (err) {
    await EmailMessage.updateOne({ _id: m._id }, { $set: { status: "FAILED", error: String(err).slice(0, 500) } });
    throw Errors.badRequest("The email provider rejected the message. See the message log for details.");
  }

  if (m.companyId) {
    const company = await Company.findById(m.companyId).select("countryCode lead.stage").lean<CompanyDoc>();
    if (company) {
      const early = ["NEW", "QUALIFIED", "RESEARCHING", "READY_FOR_OUTREACH"].includes(company.lead?.stage ?? "NEW");
      await Company.updateOne({ _id: m.companyId }, { $set: { "lead.lastContactedAt": new Date(), ...(early && { "lead.stage": "CONTACTED", "lead.stageChangedAt": new Date() }) } });
      await CrmActivity.create({ companyId: m.companyId, countryCode: company.countryCode, type: "EMAIL", body: `Email sent: ${m.subject}${provider.isLive ? "" : " (simulated — console provider)"}`, actorId: actor.id });
    }
  }
  await audit(actor, "email.sent", { entityType: "EmailMessage", entityId: id, countryCode: m.countryCode ?? undefined, metadata: { provider: provider.id, simulated: !provider.isLive } });
}

export async function markReplied(actor: Actor, id: string) {
  requireOutreach(actor);
  const m = await loadOutreachMessage(id);
  if (!["SENT", "DELIVERED"].includes(m.status)) throw Errors.badRequest("Only sent messages can receive replies.");
  await EmailMessage.updateOne({ _id: m._id }, { $set: { replyStatus: "REPLIED", repliedAt: new Date() } });
  if (m.companyId) {
    const company = await Company.findById(m.companyId).select("companyName countryCode lead").lean<CompanyDoc>();
    if (company && !stagesFrom("REPLIED").includes(company.lead?.stage ?? "NEW") && company.lead?.stage !== "DO_NOT_CONTACT") {
      await Company.updateOne({ _id: company._id }, { $set: { "lead.stage": "REPLIED", "lead.stageChangedAt": new Date() } });
    }
    if (company) {
      await CrmActivity.create({ companyId: company._id, countryCode: company.countryCode, type: "EMAIL", body: `Reply received: ${m.subject}`, actorId: actor.id });
      const owner = company.lead?.assignedTo ? String(company.lead.assignedTo) : null;
      if (owner) await notifyUsers([owner], { type: "REPLY", title: `${company.companyName} replied`, link: `/dashboard/companies/${company.countryCode.toLowerCase()}/${company._id}` });
    }
  }
  await audit(actor, "email.reply_recorded", { entityType: "EmailMessage", entityId: id });
}

export async function getOutreachMessage(actor: Actor, id: string) {
  requireOutreach(actor);
  const m = await EmailMessage.findOne({ _id: parseObjectId(id), kind: "OUTREACH" })
    .populate("companyId", "companyName countryCode website email lead.stage source isDemo")
    .populate("campaignId", "name")
    .populate("createdBy", "name")
    .populate("approvedBy", "name")
    .lean<EmailMessageDoc>();
  if (!m) throw Errors.notFound();
  const compliance = await checkSuppression(m.to);
  return { message: m, compliance };
}
