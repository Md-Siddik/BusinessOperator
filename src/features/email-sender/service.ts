import "server-only";
import { Types } from "mongoose";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { siteConfig } from "@/config/site";
import { Errors } from "@/lib/errors";
import { isOwner, type Actor } from "@/lib/permissions";
import { enforceRateLimit } from "@/lib/rate-limit";
import { emailSchema } from "@/lib/validation";
import { defaultFromAddress, emailProviderSetupProblems, EmailProviderError, getEmailProvider, providerSenderIdentity } from "@/lib/email/provider";
import { unsubscribeApiUrl, unsubscribeUrl } from "@/lib/email/unsubscribe";
import { checkSuppression } from "@/features/outreach/suppression";
import { EmailMessage, type EmailMessageDoc } from "@/models";
import { BUSINESS_EMAIL, DEFAULT_TEMPLATE, defaultTemplateContent, LIMITS, renderEmail, type EmailContent, type RenderedEmail } from "./template";

/**
 * Email Sender — OWNER ONLY. Every exported function verifies the actor's server-side
 * role first, so no internal caller or HTTP request can send without being the Owner.
 *
 * One recipient per send. Guards, in order: role → validation → provider configured →
 * suppression list → hourly/daily limits → per-recipient cooldown → idempotent lock.
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

const customSchema = z.object({
  subject: z.string().trim().min(3, "Add a subject").max(LIMITS.subject, `Keep the subject under ${LIMITS.subject} characters`),
  body: z.string().trim().min(10, "Write a message (at least 10 characters)").max(LIMITS.body, `Keep the message under ${LIMITS.body.toLocaleString("en-GB")} characters`),
  includeCta: z.boolean().default(false),
});

export const previewSchema = z.discriminatedUnion("mode", [z.object({ mode: z.literal("TEMPLATE") }), z.object({ mode: z.literal("CUSTOM") }).merge(customSchema)]);

export const sendSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("TEMPLATE"), to: emailSchema, idempotencyKey: z.string().regex(/^[A-Za-z0-9-]{16,64}$/, "Invalid request key") }),
  z.object({ mode: z.literal("CUSTOM"), to: emailSchema, idempotencyKey: z.string().regex(/^[A-Za-z0-9-]{16,64}$/, "Invalid request key") }).merge(customSchema),
]);

/** Header/subject injection guard: no line breaks in a subject. */
function cleanSubject(subject: string) {
  return subject.replace(/[\r\n\t]+/g, " ").trim();
}

function contentFor(input: z.infer<typeof previewSchema>): EmailContent {
  if (input.mode === "TEMPLATE") return defaultTemplateContent();
  return { subject: cleanSubject(input.subject), body: input.body, includeCta: input.includeCta };
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

/** Exact rendering of what will be sent (same renderer as the send path). */
export function previewEmail(actor: Actor | null, input: unknown, recipient?: string): RenderedEmail {
  assertOwner(actor);
  const data = previewSchema.parse(input);
  const unsub = recipient && emailSchema.safeParse(recipient).success ? unsubscribeUrl(recipient) : `${siteConfig.url}/unsubscribe`;
  return renderEmail(contentFor(data), { unsubscribeUrl: unsub, signature: signatureFor(senderSettings()) });
}

/** Read-only default template (for the composer's "Start from template"). Never modified by custom sends. */
export function getDefaultTemplate(actor: Actor | null) {
  assertOwner(actor);
  return { subject: DEFAULT_TEMPLATE.subject, body: DEFAULT_TEMPLATE.body, includeCta: DEFAULT_TEMPLATE.includeCta };
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

export type SendResult ={ id: string; status: "SENT"; accepted: true; provider: string; providerMessageId?: string; duplicate?: boolean };

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

  const content = contentFor(data);
  const rendered = renderEmail(content, { unsubscribeUrl: unsubscribeUrl(to), signature: signatureFor(settings) });

  // Lock first (unique idempotency key), then hand to the provider.
  let record: { _id: Types.ObjectId };
  try {
    record = await EmailMessage.create({
      kind: "DIRECT",
      mode: data.mode,
      to,
      from: settings.from,
      subject: rendered.subject,
      // Bodies are not stored: only which template, or the size of a custom message.
      body: data.mode === "TEMPLATE" ? `[template ${DEFAULT_TEMPLATE.id}]` : `[custom message, ${content.body.length} characters — content not stored]`,
      status: "SENDING",
      idempotencyKey: data.idempotencyKey,
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
    await audit(actor, "email_sender.sent", { entityType: "EmailMessage", entityId: String(record._id), metadata: { mode: data.mode, recipientDomain: to.split("@")[1], provider: provider.id } });
    console.info(`[email-sender] accepted by ${provider.id} (record ${String(record._id)})`);
    return { id: String(record._id), status: "SENT", accepted: true, provider: provider.id, providerMessageId: result.id };
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
    EmailMessage.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 25).limit(25).select("to mode subject status provider providerMessageId error createdBy createdAt sentAt").populate("createdBy", "name").lean<EmailMessageDoc[]>(),
    EmailMessage.countDocuments(filter),
  ]);
  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / 25)) };
}
