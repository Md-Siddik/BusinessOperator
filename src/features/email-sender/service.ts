import "server-only";
import { Types } from "mongoose";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { siteConfig } from "@/config/site";
import { Errors } from "@/lib/errors";
import { isOwner, type Actor } from "@/lib/permissions";
import { enforceRateLimit } from "@/lib/rate-limit";
import { emailSchema, parseObjectId } from "@/lib/validation";
import { defaultFromAddress, emailProviderSetupProblems, EmailProviderError, getEmailProvider, providerSenderIdentity } from "@/lib/email/provider";
import { unsubscribeApiUrl, unsubscribeUrl } from "@/lib/email/unsubscribe";
import { checkSuppression } from "@/features/outreach/suppression";
import { NOT_CONTACTED_STAGES } from "@/features/companies/service";
import { Company, CrmActivity, EmailMessage, type CompanyDoc, type EmailMessageDoc } from "@/models";
import { stagesFrom } from "@/lib/constants";
import { BUSINESS_EMAIL, DEFAULT_TEMPLATE, EMAIL_LOCALES, LIMITS, renderEmail, type EmailContent, type EmailLocale, type RenderedEmail } from "./template";
import { buildOutreachEmail, OUTREACH_SERVICE, OUTREACH_TEMPLATE_IDS, OUTREACH_TEMPLATE_LABELS, outreachContext, suggestOutreach, type OutreachCompany, type OutreachOffer, type OutreachTemplateId } from "./outreach";
import { localizedPath } from "@/config/languages";
import { getBaseMessages } from "@/lib/i18n/dictionaries";
import { createTranslator } from "@/lib/i18n/translator";
import { priceDisplay, priceLabelsFrom } from "@/lib/service-pricing";
import { getPublicService } from "@/features/service-catalog/service";
import { withCampaign } from "@/features/website-analytics/classify";

/**
 * Email Sender — OWNER ONLY. Every exported function verifies the actor's server-side
 * role first, so no internal caller or HTTP request can send without being the Owner.
 *
 * One recipient per send. Guards, in order: role → validation → company eligibility (when
 * sent from Company Intelligence) → provider configured → suppression list → hourly/daily
 * limits → per-recipient cooldown → idempotent lock.
 * Status is honest: SENT means "accepted by the provider", never "delivered".
 */

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
export function senderSettings() {
  return {
    hourlyLimit: num(process.env.EMAIL_SENDER_HOURLY_LIMIT, 20),
    dailyLimit: num(process.env.EMAIL_SENDER_DAILY_LIMIT, 50),
    cooldownMinutes: num(process.env.EMAIL_SENDER_COOLDOWN_MINUTES, 60),
    retentionDays: num(process.env.EMAIL_SENDER_RETENTION_DAYS, 365),
    // Zoho SMTP dictates the sender: the authenticated mailbox (or its alias), EMAIL_FROM_ADDRESS.
    from: providerSenderIdentity()?.address || process.env.EMAIL_SENDER_FROM?.trim() || defaultFromAddress(),
    fromName: providerSenderIdentity()?.name || process.env.EMAIL_SENDER_FROM_NAME?.trim() || `${siteConfig.name} Team`,
    // Replies go to a monitored mailbox. With Zoho that is the sending mailbox itself unless
    // EMAIL_REPLY_TO names another one, so From and Reply-To stay consistent.
    replyTo: process.env.EMAIL_REPLY_TO?.trim() || providerSenderIdentity()?.address || BUSINESS_EMAIL,
    postalAddress: process.env.EMAIL_SENDER_POSTAL_ADDRESS?.trim() || undefined,
  };
}

function signatureFor(s: ReturnType<typeof senderSettings>) {
  return { name: s.fromName, email: s.replyTo, phone: siteConfig.contact.phone || undefined, postalAddress: s.postalAddress };
}

function assertOwner(actor: Actor | null | undefined): asserts actor is Actor {
  if (!actor) throw Errors.unauthorized();
  if (!isOwner(actor)) throw Errors.forbidden();
}

/* ───────────── Validation ───────────── */

const localeSchema = z.enum(EMAIL_LOCALES).optional();

const customSchema = z.object({
  subject: z.string().trim().min(3, "Add a subject").max(LIMITS.subject, `Keep the subject under ${LIMITS.subject} characters`),
  body: z.string().trim().min(10, "Write a message (at least 10 characters)").max(LIMITS.body, `Keep the message under ${LIMITS.body.toLocaleString("en-GB")} characters`),
  includeCta: z.boolean().default(false),
  locale: localeSchema,
});

/** TEMPLATE mode: optional template and language; with a company both default to the suggestion for it. */
const templateFields = { templateId: z.enum(OUTREACH_TEMPLATE_IDS).optional(), locale: localeSchema };
const companyIdSchema = z.string().regex(/^[a-f0-9]{24}$/i, "Invalid company").optional();

export const previewSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("TEMPLATE"), companyId: companyIdSchema, ...templateFields }),
  z.object({ mode: z.literal("CUSTOM"), companyId: companyIdSchema }).merge(customSchema),
]);

const sendBase = {
  to: emailSchema,
  idempotencyKey: z.string().regex(/^[A-Za-z0-9-]{16,64}$/, "Invalid request key"),
  /** Set by Company Intelligence (Quick Send / Custom email): links the send to the company's contact tracking. */
  companyId: companyIdSchema,
};

export const sendSchema = z.discriminatedUnion("mode", [z.object({ mode: z.literal("TEMPLATE"), ...sendBase, ...templateFields }), z.object({ mode: z.literal("CUSTOM"), ...sendBase }).merge(customSchema)]);

/** Header/subject injection guard: no line breaks in a subject. */
function cleanSubject(subject: string) {
  return subject.replace(/[\r\n\t]+/g, " ").trim();
}

/** Minimum days between the first email and the single polite reminder. */
const reminderMinDays = () => num(process.env.EMAIL_SENDER_REMINDER_MIN_DAYS, 7);

type ResolvedContent = { content: EmailContent; templateId?: OutreachTemplateId; ref?: string; step?: "INITIAL" | "REMINDER" };

/**
 * TEMPLATE: the chosen (or, for a company, the suggested) template in the chosen language,
 * personalised from the company record loaded on the server — never from browser input.
 * CUSTOM: the Owner's own text.
 */
async function contentFor(input: z.infer<typeof previewSchema>, company: EmailCompany | null): Promise<ResolvedContent> {
  if (input.mode === "CUSTOM") return { content: trackedCta({ subject: cleanSubject(input.subject), body: input.body, includeCta: input.includeCta, locale: input.locale }, "outreach-custom") };
  const suggestion = company ? suggestOutreach(company) : null;
  const templateId = input.templateId ?? suggestion?.templateId ?? "general";
  const locale = input.locale ?? suggestion?.locale ?? "en";
  const offer = await offerFor(templateId, locale);
  const built = buildOutreachEmail(templateId, locale, { ...(company ? outreachContext(company) : {}), offer });
  return { content: trackedCta(built, `outreach-${templateId}`), templateId, ref: built.ref, step: templateId === "reminder" ? "REMINDER" : "INITIAL" };
}

/**
 * The button link carries UTM tags (source email, medium outreach, campaign = template), so
 * Website Analytics shows which emails bring visits. No per-recipient id; links typed in the body are untouched.
 */
function trackedCta<C extends EmailContent>(content: C, campaign: string): C {
  if (!content.includeCta) return content;
  const cta = content.cta ?? DEFAULT_TEMPLATE.cta;
  return { ...content, cta: { ...cta, url: withCampaign(cta.url, siteConfig.domain, { source: "email", medium: "outreach", campaign }) } };
}

/**
 * The template's service from Service Management, in the email's language: its current price
 * (with an active discount), delivery time and landing page. None when the service is not live —
 * the email then says the price is agreed in writing and links to the homepage.
 */
async function offerFor(templateId: OutreachTemplateId, locale: EmailLocale): Promise<OutreachOffer | undefined> {
  const slug = OUTREACH_SERVICE[templateId];
  if (!slug) return undefined;
  const service = await getPublicService(slug, locale).catch(() => null);
  if (!service) return undefined;
  const { t } = createTranslator(getBaseMessages(locale));
  const p = priceDisplay(service.pricing, service.discount, priceLabelsFrom(t), locale);
  const until = p.validUntil ? t("servicePages.ui.validUntil", { date: p.validUntil.toLocaleDateString(locale === "no" ? "nb-NO" : "en-GB", { day: "numeric", month: "long", year: "numeric" }) }) : "";
  const priceText = p.originalText ? `${p.text} (${[p.discountLabel, until].filter(Boolean).join(", ")})` : p.text;
  return { name: service.name, priceText, deliveryText: service.landing.delivery, url: `https://${siteConfig.domain}${localizedPath(locale, `/services/${slug}`)}` };
}

/* ───────────── Status & preview ───────────── */

export type SenderStatus = {
  configured: boolean;
  provider: string;
  from: string;
  fromName: string;
  replyTo: string;
  problems: string[];
  limits: { hourly: number; daily: number; cooldownMinutes: number };
};

/** What would block a real send right now (shown on the page; no secrets). */
export function getSenderStatus(actor: Actor | null): SenderStatus {
  assertOwner(actor);
  const s = senderSettings();
  const provider = getEmailProvider();
  const problems: string[] = [];
  if (!provider.isLive) {
    const setup = emailProviderSetupProblems();
    problems.push(`No email provider is configured, so nothing can be sent.${setup.length ? ` ${setup.join(" ")}` : " Restart the server after changing the email settings."}`);
  }
  if (!/^https:\/\//.test(siteConfig.url) || /localhost|127\.0\.0\.1/.test(siteConfig.url)) {
    problems.push(`NEXT_PUBLIC_SITE_URL is "${siteConfig.url}". Set it to https://${siteConfig.domain} so the unsubscribe link in every email works for recipients.`);
  }
  return { configured: problems.length === 0, provider: provider.id, from: s.from, fromName: s.fromName, replyTo: s.replyTo, problems, limits: { hourly: s.hourlyLimit, daily: s.dailyLimit, cooldownMinutes: s.cooldownMinutes } };
}

/** Exact rendering of what will be sent (same renderer and same personalisation as the send path). */
export async function previewEmail(actor: Actor | null, input: unknown, recipient?: string): Promise<RenderedEmail> {
  assertOwner(actor);
  const data = previewSchema.parse(input);
  const company = data.companyId ? await loadCompany(data.companyId) : null;
  const unsub = recipient && emailSchema.safeParse(recipient).success ? unsubscribeUrl(recipient) : `${siteConfig.url}/unsubscribe`;
  return renderEmail((await contentFor(data, company)).content, { unsubscribeUrl: unsub, signature: signatureFor(senderSettings()) });
}

/** Read-only default template (for the composer's "Start from template"). Never modified by custom sends. */
export function getDefaultTemplate(actor: Actor | null) {
  assertOwner(actor);
  return { subject: DEFAULT_TEMPLATE.subject, body: DEFAULT_TEMPLATE.body, includeCta: DEFAULT_TEMPLATE.includeCta };
}

export type TemplateOption = { id: OutreachTemplateId; label: string };
export const TEMPLATE_OPTIONS: TemplateOption[] = OUTREACH_TEMPLATE_IDS.map((id) => ({ id, label: OUTREACH_TEMPLATE_LABELS[id] }));

/** Every template in every language without company data — for the standalone Email Sender page. */
export async function listTemplates(actor: Actor | null) {
  assertOwner(actor);
  const out: Record<string, { subject: string; body: string; includeCta: boolean }> = {};
  for (const id of OUTREACH_TEMPLATE_IDS) {
    for (const locale of EMAIL_LOCALES) {
      const b = buildOutreachEmail(id, locale, { offer: await offerFor(id, locale) });
      out[`${id}:${locale}`] = { subject: b.subject, body: b.body, includeCta: !!b.includeCta };
    }
  }
  return out;
}

export type CompanyTemplate = {
  templateId: OutreachTemplateId;
  locale: EmailLocale;
  subject: string;
  body: string;
  includeCta: boolean;
  suggestion: { templateId: OutreachTemplateId; locale: EmailLocale; reason: string };
  reminder: { allowed: boolean; reason: string };
};

/**
 * The personalised template for one company (Company Intelligence Quick Send / Custom email):
 * the suggestion, the selected template text, and whether the one reminder may be sent now.
 */
export async function getCompanyTemplate(actor: Actor | null, input: unknown): Promise<CompanyTemplate> {
  assertOwner(actor);
  const q = z.object({ companyId: z.string().regex(/^[a-f0-9]{24}$/i, "Invalid company"), ...templateFields }).parse(input);
  const company = await loadCompany(q.companyId);
  const suggestion = suggestOutreach(company);
  const templateId = q.templateId ?? suggestion.templateId;
  const locale = q.locale ?? suggestion.locale;
  const built = buildOutreachEmail(templateId, locale, { ...outreachContext(company), offer: await offerFor(templateId, locale) });
  const reminder = await reminderCheck(company);
  return { templateId, locale, subject: built.subject, body: built.body, includeCta: !!built.includeCta, suggestion, reminder: reminder.ok ? { allowed: true, reason: "One polite reminder can be sent." } : { allowed: false, reason: reminder.message } };
}

/* ───────────── Sending ───────────── */

type RejectionReason = NonNullable<EmailProviderError["reason"]>;
const REJECTION_LABEL: Record<RejectionReason, string> = { auth: "sign-in failed", sender: "sender refused", recipient: "recipient refused", message: "message refused" };
const REJECTION_HELP: Record<RejectionReason, string> = {
  auth: "The mail server refused the sign-in, so the email was not sent. Check ZOHO_SMTP_USER and ZOHO_SMTP_PASSWORD on the server (with two-factor authentication on, use a Zoho application-specific password).",
  sender: "The mail server refused the sender address, so the email was not sent. EMAIL_FROM_ADDRESS must be the Zoho mailbox you sign in with, or one of its aliases.",
  recipient: "The mail server refused this recipient address, so the email was not sent. Check the address for typos.",
  message: "The mail server refused the message, so it was not sent. Try again later; if it keeps happening, check your Zoho Mail sending limits.",
};

export type SendResult = { id: string; status: "SENT"; accepted: true; provider: string; providerMessageId?: string; duplicate?: boolean; company?: { stage: string; lastContactedAt: string } };

type SendCompany = Pick<CompanyDoc, "_id" | "countryCode" | "marketingProtected" | "isDemo" | "lead">;
type EmailCompany = SendCompany & OutreachCompany;

/** Fields used for sending checks and personalisation (registry / research data only). */
const EMAIL_COMPANY_FIELDS = "companyName countryCode website city registrationDay contactPerson research.attempts signals.hiring auditSummary marketingProtected isDemo lead.stage";

async function loadCompany(id: string) {
  const company = await Company.findById(parseObjectId(id)).select(EMAIL_COMPANY_FIELDS).lean<EmailCompany>();
  if (!company) throw Errors.notFound("Company not found.");
  return company;
}

/**
 * At most ONE polite reminder per company: only after a first email that the provider accepted,
 * no sooner than EMAIL_SENDER_REMINDER_MIN_DAYS (default 7) later, and never after the company
 * replied or once a reminder was sent. Then we stop.
 */
async function reminderCheck(company: EmailCompany): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const sent = await EmailMessage.find({ kind: "DIRECT", companyId: company._id, status: "SENT" }).select("outreachStep sentAt createdAt").sort({ createdAt: 1 }).lean<EmailMessageDoc[]>();
  if (sent.some((m) => m.outreachStep === "REMINDER")) return { ok: false, code: "REMINDER_ALREADY_SENT", message: "A reminder was already sent to this company. We send at most one reminder — no further follow-ups." };
  const first = sent[0];
  if (!first) return { ok: false, code: "NO_INITIAL_EMAIL", message: "No earlier email to this company was sent from the Email Sender. Send a first email instead of a reminder." };
  if (stagesFrom("REPLIED").includes(company.lead?.stage ?? "NEW")) return { ok: false, code: "ALREADY_REPLIED", message: "This company has already replied — continue the conversation instead of sending a reminder." };
  const minDays = reminderMinDays();
  const days = (Date.now() - (first.sentAt ?? first.createdAt).getTime()) / 86_400_000;
  if (days < minDays) return { ok: false, code: "REMINDER_TOO_EARLY", message: `The first email was sent ${Math.floor(days)} day${Math.floor(days) === 1 ? "" : "s"} ago. Wait at least ${minDays} days before the one polite reminder.` };
  return { ok: true };
}

/** A company the Owner emails from Company Intelligence must exist, be real data and not be protected from marketing. */
async function companyForSend(id: string) {
  const company = await loadCompany(id);
  if (company.isDemo) throw Errors.badRequest("This is a demo company — its contact details are not real, so no email was sent.", { code: "DEMO_COMPANY" });
  if (company.marketingProtected) throw Errors.badRequest("The registry marks this company as protected from marketing. The email was not sent.", { code: "MARKETING_PROTECTED" });
  if (company.lead?.stage === "DO_NOT_CONTACT") throw Errors.badRequest("This company is marked Do not contact. The email was not sent.", { code: "DO_NOT_CONTACT" });
  return company;
}

/**
 * The existing contact tracking (same as a logged contact attempt): last contacted date, an
 * early-stage lead moves to Contacted, and an EMAIL activity on the company timeline.
 * Runs after the provider accepted the email, so a tracking failure never invites a re-send.
 */
async function recordCompanyContact(actor: Actor, company: SendCompany, mode: "TEMPLATE" | "CUSTOM", label: string, subject: string, messageId: string) {
  const now = new Date();
  const stage = company.lead?.stage ?? "NEW";
  const early = NOT_CONTACTED_STAGES.includes(stage);
  try {
    await Company.updateOne({ _id: company._id }, { $set: { "lead.lastContactedAt": now, ...(early && { "lead.stage": "CONTACTED", "lead.stageChangedAt": now }) } });
    await CrmActivity.create({
      companyId: company._id,
      countryCode: company.countryCode,
      type: "EMAIL",
      body: `Email sent (${label}): ${subject}`,
      meta: { emailMessageId: messageId, mode },
      actorId: actor.id,
    });
  } catch (e) {
    console.warn(`[email-sender] sent, but contact tracking failed for company ${String(company._id)}`, e);
  }
  return { stage: early ? "CONTACTED" : stage, lastContactedAt: now.toISOString() };
}

export async function sendEmail(actor: Actor | null, input: unknown): Promise<SendResult> {
  assertOwner(actor);
  const data = sendSchema.parse(input);
  const settings = senderSettings();
  const to = data.to.toLowerCase();

  // A repeated submission (double click, retry after a slow response) never sends twice.
  const previous = await EmailMessage.findOne({ idempotencyKey: data.idempotencyKey }).lean<EmailMessageDoc>();
  if (previous) {
    if (String(previous.createdBy) !== actor.id) throw Errors.conflict("This request was already used.");
    if (previous.status === "SENT") return { id: String(previous._id), status: "SENT", accepted: true, provider: previous.provider ?? "", providerMessageId: previous.providerMessageId ?? undefined, duplicate: true };
    if (previous.status === "SENDING") throw Errors.conflict("This email is already being sent. Check the history in a moment.");
    throw Errors.conflict("This send attempt already finished without being accepted. Review the error, then send again.");
  }

  const company = data.companyId ? await companyForSend(data.companyId) : null;
  const resolved = await contentFor(data, company);

  // The single polite reminder: only for a company, only once, only after the waiting period.
  if (resolved.step === "REMINDER") {
    if (!company) throw Errors.badRequest("A reminder can only be sent from Company Intelligence, to a company that was emailed before.", { code: "REMINDER_NEEDS_COMPANY" });
    const check = await reminderCheck(company);
    if (!check.ok) throw Errors.badRequest(check.message, { code: check.code });
  }

  const status = getSenderStatus(actor);
  if (!status.configured) throw Errors.badRequest(`Email delivery is not set up: ${status.problems.join(" ")}`, { code: "NOT_CONFIGURED" });

  const suppression = await checkSuppression(to);
  if (suppression.suppressed) throw Errors.badRequest("This recipient has opted out or is on the suppression list. The email was not sent.", { code: "SUPPRESSED" });

  enforceRateLimit({ bucket: "email-sender-hour", limit: settings.hourlyLimit, windowMs: 60 * 60_000 }, actor.id);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const today = await EmailMessage.countDocuments({ kind: "DIRECT", status: { $in: ["SENT", "SENDING"] }, createdAt: { $gte: startOfDay } });
  if (today >= settings.dailyLimit) throw Errors.tooManyRequests(`Daily sending limit reached (${settings.dailyLimit} emails). Try again tomorrow.`);

  // Cooldown per recipient: also blocks re-sends after an "outcome unknown" failure.
  if (settings.cooldownMinutes > 0) {
    const since = new Date(Date.now() - settings.cooldownMinutes * 60_000);
    const recent = await EmailMessage.findOne({ kind: "DIRECT", to, createdAt: { $gte: since }, $or: [{ status: { $in: ["SENT", "SENDING"] } }, { status: "FAILED", error: /outcome unknown/ }] })
      .select("createdAt status")
      .lean<EmailMessageDoc>();
    if (recent) {
      const wait = Math.ceil((recent.createdAt.getTime() + settings.cooldownMinutes * 60_000 - Date.now()) / 60_000);
      throw Errors.tooManyRequests(`An email to ${to} was sent ${recent.status === "FAILED" ? "(outcome unknown) " : ""}recently. To avoid duplicates, wait ${wait} minute${wait === 1 ? "" : "s"} before sending to this address again.`);
    }
  }

  const content = resolved.content;
  const rendered = renderEmail(content, { unsubscribeUrl: unsubscribeUrl(to), signature: signatureFor(settings) });

  // Lock first (unique idempotency key), then hand to the provider.
  let record: { _id: Types.ObjectId };
  try {
    record = await EmailMessage.create({
      kind: "DIRECT",
      mode: data.mode,
      ...(company && { companyId: company._id, countryCode: company.countryCode }),
      to,
      from: settings.from,
      subject: rendered.subject,
      // Bodies are not stored: only which template, or the size of a custom message.
      body: data.mode === "TEMPLATE" ? `[template ${resolved.ref}]` : `[custom message, ${content.body.length} characters — content not stored]`,
      status: "SENDING",
      idempotencyKey: data.idempotencyKey,
      ...(resolved.ref && { outreachTemplate: resolved.ref }),
      outreachStep: resolved.step ?? "INITIAL",
      locale: content.locale ?? "en",
      createdBy: new Types.ObjectId(actor.id),
      compliance: { checkedAt: new Date(), suppressed: false },
      expiresAt: new Date(Date.now() + settings.retentionDays * 86_400_000),
    });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw Errors.conflict("This email is already being sent.");
    throw e;
  }

  const provider = getEmailProvider();
  try {
    const result = await provider.send({
      to,
      from: settings.from,
      fromName: settings.fromName,
      replyTo: settings.replyTo,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      headers: { "List-Unsubscribe": `<${unsubscribeApiUrl(to)}>, <mailto:${settings.replyTo}?subject=Unsubscribe>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
    await EmailMessage.updateOne({ _id: record._id }, { $set: { status: "SENT", sentAt: new Date(), provider: provider.id, providerMessageId: result.id, simulated: !provider.isLive } });
    await audit(actor, "email_sender.sent", { entityType: "EmailMessage", entityId: String(record._id), metadata: { mode: data.mode, recipientDomain: to.split("@")[1], provider: provider.id, ...(company && { companyId: String(company._id) }) } });
    console.info(`[email-sender] accepted by ${provider.id} (record ${String(record._id)})`);
    const label = data.mode === "CUSTOM" ? "custom email" : resolved.templateId === "general" ? "default template" : `${OUTREACH_TEMPLATE_LABELS[resolved.templateId!].toLowerCase()} template`;
    const tracked = company ? await recordCompanyContact(actor, company, data.mode, label, rendered.subject, String(record._id)) : undefined;
    return { id: String(record._id), status: "SENT", accepted: true, provider: provider.id, providerMessageId: result.id, ...(tracked && { company: tracked }) };
  } catch (err) {
    const unknown = !(err instanceof EmailProviderError) || err.outcome === "unknown";
    const reason = err instanceof EmailProviderError ? err.reason : undefined;
    const statusLabel = err instanceof EmailProviderError && err.status ? ` (${provider.id === "zoho-smtp" ? "SMTP" : "HTTP"} ${err.status})` : "";
    // Stored error text is generic — provider responses can contain account details.
    const error = unknown ? "Provider did not confirm (timeout or network error) — outcome unknown" : `Provider rejected the message${reason ? `: ${REJECTION_LABEL[reason]}` : ""}${statusLabel}`;
    await EmailMessage.updateOne({ _id: record._id }, { $set: { status: "FAILED", provider: provider.id, error } });
    await audit(actor, "email_sender.failed", { entityType: "EmailMessage", entityId: String(record._id), metadata: { mode: data.mode, outcome: unknown ? "unknown" : "rejected" } });
    console.warn(`[email-sender] ${unknown ? "outcome unknown" : "rejected"} by ${provider.id} (record ${String(record._id)})`);
    throw Errors.badRequest(
      unknown
        ? "The email provider did not confirm the send (timeout or network error). It may or may not have been sent — check your provider (for Zoho Mail, the Sent folder) before trying again. Re-sending to this address is paused for the cooldown period."
        : reason
          ? REJECTION_HELP[reason]
          : "The email provider rejected the message. Check the provider configuration (API key, verified sending domain and sender address), then try again.",
      { code: unknown ? "OUTCOME_UNKNOWN" : "PROVIDER_REJECTED" },
    );
  }
}

/* ───────────── History ───────────── */

export async function listSentEmails(actor: Actor | null, opts: { page?: number } = {}) {
  assertOwner(actor);
  const page = Math.max(1, opts.page ?? 1);
  const filter = { kind: "DIRECT" as const };
  const [items, total] = await Promise.all([
    EmailMessage.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 25).limit(25).select("to mode outreachTemplate outreachStep locale subject status provider providerMessageId error createdBy createdAt sentAt").populate("createdBy", "name").lean<EmailMessageDoc[]>(),
    EmailMessage.countDocuments(filter),
  ]);
  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / 25)) };
}

/** Removes one sent-email record from the history. A message still SENDING cannot be removed. */
export async function deleteSentEmail(actor: Actor | null, id: string) {
  assertOwner(actor);
  const record = await EmailMessage.findOne({ _id: parseObjectId(id), kind: "DIRECT" }).select("status").lean<EmailMessageDoc>();
  if (!record) throw Errors.notFound("Email not found.");
  if (record.status === "SENDING") throw Errors.conflict("This email is still being sent. Try again in a moment.");
  await EmailMessage.deleteOne({ _id: record._id });
  await audit(actor, "email_sender.deleted", { entityType: "EmailMessage", entityId: id });
  return { ok: true };
}
