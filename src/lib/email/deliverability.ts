import "server-only";
import { promises as dns } from "node:dns";
import { Contact, EmailMessage, SuppressionEntry } from "@/models";
import { siteConfig } from "@/config/site";
import { escapeHtml } from "./render";

/**
 * Deliverability helpers for transactional email:
 *  - the verification-code email (subject, plain text and a light, link-free HTML part)
 *  - a live check of the sending domain's SPF / DKIM / DMARC records
 *  - delivery health (sent / failed / bounced) for the Owner's Email settings
 *  - bounce (DSN) parsing for messages returned to the Zoho mailbox
 */

/* ───────────────────────── Verification email ───────────────────────── */

export const VERIFICATION_CODE_MINUTES = 10;

/**
 * Plain, personal and short: no links, images, tracking or marketing wording — the kind of message
 * mailbox providers classify as a transactional notification. The code is in the subject so it can
 * be read from the notification; the HTML repeats the text part exactly.
 */
export function verificationEmail(input: { code: string; purpose: "VERIFY" | "MFA"; name?: string | null; minutes?: number }) {
  const minutes = input.minutes ?? VERIFICATION_CODE_MINUTES;
  const brand = siteConfig.name;
  const first = input.name?.trim().split(/\s+/)[0];
  const action = input.purpose === "MFA" ? "finish signing in" : "confirm your email address";
  const subject = input.purpose === "MFA" ? `${input.code} is your ${brand} sign-in code` : `${input.code} is your ${brand} verification code`;
  const greeting = first ? `Hi ${first},` : "Hello,";
  const lead = `Your ${brand} ${input.purpose === "MFA" ? "sign-in" : "verification"} code is`;
  const after = `Enter it to ${action}. The code expires in ${minutes} minutes and can be used once. Never share it — ${brand} will never ask you for it.\n\nIf you didn't request this code, you can ignore this email; nothing will change.`;
  const footer = `${brand} · ${siteConfig.url.replace(/^https?:\/\//, "")}\nYou received this because this address was used to ${input.purpose === "MFA" ? "sign in to" : "create or verify"} an account.`;
  const text = `${greeting}\n\n${lead} ${input.code}.\n\n${after}\n\n— ${brand}\n\n${footer}`;
  const intro = `${greeting}\n\n${lead}:`;
  const p = (s: string) => escapeHtml(s).replace(/\n/g, "<br>");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f7fb;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your code: ${escapeHtml(input.code)} — expires in ${minutes} minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f7fb;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:#ffffff;border:1px solid #dfe3ea;border-radius:12px;">
<tr><td style="padding:28px 28px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.55;color:#121722;">
<p style="margin:0 0 18px;font-size:14px;font-weight:600;color:#2139b5;">${escapeHtml(brand)}</p>
<p style="margin:0 0 16px;">${p(intro)}</p>
<p style="margin:0 0 18px;padding:14px 0;text-align:center;background:#eef3ff;border-radius:8px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:30px;font-weight:700;letter-spacing:8px;color:#121722;">${escapeHtml(input.code)}</p>
<p style="margin:0 0 16px;">${p(after)}</p>
<p style="margin:0 0 20px;">— ${escapeHtml(brand)}</p>
</td></tr>
<tr><td style="padding:14px 28px 22px;border-top:1px solid #eef0f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;line-height:1.5;color:#6b7588;">${p(footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  return { subject, text, html };
}

/* ───────────────────────── Sending-domain authentication ───────────────────────── */

export type DnsCheck = { name: string; status: "pass" | "warn" | "missing" | "error"; found?: string; detail: string; fix?: string };

/** Public resolvers used only when the system resolver can't be reached (e.g. a local stub that refuses queries). */
const FALLBACK_RESOLVERS = ["1.1.1.1", "8.8.8.8"];

async function txt(host: string): Promise<string[] | null> {
  const attempt = async (resolver: Pick<typeof dns, "resolveTxt">) => (await resolver.resolveTxt(host)).map((parts) => parts.join(""));
  try {
    return await attempt(dns);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "ENOTFOUND" || code === "ENODATA") return [];
    try {
      const fallback = new dns.Resolver({ timeout: 4000, tries: 2 });
      fallback.setServers(FALLBACK_RESOLVERS);
      return await attempt(fallback);
    } catch (e2) {
      const c2 = (e2 as { code?: string }).code;
      return c2 === "ENOTFOUND" || c2 === "ENODATA" ? [] : null;
    }
  }
}

/**
 * SPF, DKIM (selector from EMAIL_DKIM_SELECTOR, default "zoho") and DMARC for the sending domain.
 * Read-only DNS lookups; the fixes are the exact records to add at the DNS host.
 */
export async function checkSenderDomain(fromAddress: string, provider = (process.env.EMAIL_PROVIDER || "console").toLowerCase()): Promise<{ domain: string; checks: DnsCheck[] }> {
  const domain = fromAddress.split("@")[1]?.toLowerCase() ?? "";
  const selector = (process.env.EMAIL_DKIM_SELECTOR || "zoho").trim();
  const spfInclude = provider === "zoho-smtp" ? "include:zohomail.com" : provider === "sendgrid" ? "include:sendgrid.net" : provider === "resend" ? "include:amazonses.com" : null;
  const checks: DnsCheck[] = [];
  if (!domain) return { domain, checks };

  const root = await txt(domain);
  const spf = root?.filter((r) => /^v=spf1\b/i.test(r)) ?? [];
  if (root === null) checks.push({ name: "SPF", status: "error", detail: "DNS lookup failed — try again later." });
  else if (!spf.length) checks.push({ name: "SPF", status: "missing", detail: "No SPF record: receivers can't tell which servers may send for this domain.", fix: `TXT  ${domain}  "v=spf1 ${spfInclude ?? "include:<your provider>"} ~all"` });
  else if (spf.length > 1) checks.push({ name: "SPF", status: "warn", found: spf.join(" | "), detail: "More than one SPF record — receivers treat this as a permanent error. Merge them into one record." });
  else if (spfInclude && !spf[0]!.toLowerCase().includes(spfInclude)) checks.push({ name: "SPF", status: "warn", found: spf[0], detail: `The SPF record doesn't authorise your email provider (${spfInclude}).`, fix: `Add ${spfInclude} to the existing SPF record.` });
  else checks.push({ name: "SPF", status: /\+all/i.test(spf[0]!) ? "warn" : "pass", found: spf[0], detail: /\+all/i.test(spf[0]!) ? "“+all” lets any server send for the domain — use ~all or -all." : "Authorises the sending provider." });
  const strayDkim = root?.find((r) => /^v=DKIM1/i.test(r));
  if (strayDkim) checks.push({ name: "Stray DKIM key", status: "warn", detail: `A DKIM key is published on ${domain} itself, where no receiver looks. It is harmless but should be removed; the active key belongs at ${selector}._domainkey.${domain}.` });

  const dkim = await txt(`${selector}._domainkey.${domain}`);
  if (dkim === null) checks.push({ name: "DKIM", status: "error", detail: "DNS lookup failed — try again later." });
  else if (!dkim.some((r) => /v=DKIM1/i.test(r) && /p=[A-Za-z0-9+/]{40,}/.test(r))) checks.push({ name: "DKIM", status: "missing", detail: `No DKIM public key at ${selector}._domainkey.${domain}. Mail is not signed in a way receivers can verify.`, fix: provider === "zoho-smtp" ? "Zoho Mail Admin → Domains → Email configuration → DKIM: add a selector, publish the TXT record it shows, then click Verify." : "Publish the DKIM key your email provider shows for this domain." });
  else checks.push({ name: "DKIM", status: "pass", found: `${selector}._domainkey`, detail: `Public key published for selector “${selector}”. Make sure signing is switched on in the provider's admin console.` });

  const dmarc = await txt(`_dmarc.${domain}`);
  const rec = dmarc?.find((r) => /^v=DMARC1/i.test(r));
  if (dmarc === null) checks.push({ name: "DMARC", status: "error", detail: "DNS lookup failed — try again later." });
  else if (!rec) checks.push({ name: "DMARC", status: "missing", detail: "No DMARC record. Gmail and Yahoo require one for reliable delivery, and without it messages are more likely to land in spam.", fix: `TXT  _dmarc.${domain}  "v=DMARC1; p=none; rua=mailto:${fromAddress.toLowerCase()}; adkim=r; aspf=r; pct=100"` });
  else {
    const policy = /;\s*p=(none|quarantine|reject)/i.exec(rec)?.[1]?.toLowerCase();
    checks.push({ name: "DMARC", status: "pass", found: rec, detail: policy === "none" ? "Published (monitoring mode p=none). After 2–4 weeks of clean reports, move to p=quarantine." : `Published with policy p=${policy ?? "?"}.` });
  }
  return { domain, checks };
}

/* ───────────────────────── Delivery health ───────────────────────── */

export function maskEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}${"*".repeat(Math.max(1, Math.min(6, local.length - 1)))}@${domain}`;
}

/** Transactional delivery over the last `days` days (verification codes separately). */
export async function transactionalHealth(days = 7) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await EmailMessage.aggregate<{ _id: { status: string; category: string | null }; n: number }>([
    { $match: { kind: "TRANSACTIONAL", createdAt: { $gte: since } } },
    { $group: { _id: { status: "$status", category: { $ifNull: ["$category", null] } }, n: { $sum: 1 } } },
  ]);
  const sum = (pred: (r: (typeof rows)[number]) => boolean) => rows.filter(pred).reduce((a, r) => a + r.n, 0);
  const failures = await EmailMessage.find({ kind: "TRANSACTIONAL", createdAt: { $gte: since }, status: { $in: ["FAILED", "BOUNCED"] } })
    .select("to category status error createdAt provider")
    .sort({ createdAt: -1 })
    .limit(10)
    .lean<{ to: string; category?: string; status: string; error?: string; createdAt: Date; provider?: string }[]>();
  return {
    days,
    total: sum(() => true),
    sent: sum((r) => r._id.status === "SENT" || r._id.status === "DELIVERED"),
    failed: sum((r) => r._id.status === "FAILED"),
    bounced: sum((r) => r._id.status === "BOUNCED"),
    codes: { total: sum((r) => r._id.category === "VERIFICATION"), failed: sum((r) => r._id.category === "VERIFICATION" && (r._id.status === "FAILED" || r._id.status === "BOUNCED")) },
    recentFailures: failures.map((f) => ({ to: maskEmail(f.to), category: f.category ?? "NOTIFICATION", status: f.status, reason: (f.error ?? "").slice(0, 160), at: f.createdAt.toISOString(), provider: f.provider })),
  };
}

/* ───────────────────────── Bounces ───────────────────────── */

const BOUNCE_SENDER = /^(mailer-daemon|postmaster|mail-daemon|bounce[s]?)@/i;
const BOUNCE_SUBJECT = /(undeliver|delivery (status notification|has failed|failure)|returned mail|mail delivery (failed|subsystem)|failure notice|non[- ]?delivery|could not be delivered)/i;

export function looksLikeBounce(fromAddress: string, subject: string) {
  return BOUNCE_SENDER.test(fromAddress) || BOUNCE_SUBJECT.test(subject);
}

/** The failed recipient and diagnostic of a DSN / bounce message (RFC 3464 fields first, then plain-text fallbacks). */
export function parseBounce(raw: string, ownAddresses: string[] = []): { recipient: string; diagnostic?: string } | null {
  const own = new Set(ownAddresses.map((a) => a.toLowerCase()));
  const field = (name: string) => new RegExp(`^${name}:\\s*(?:rfc822;)?\\s*<?([^\\s<>;]+@[^\\s<>;]+)>?`, "im").exec(raw)?.[1]?.toLowerCase();
  let recipient = field("Final-Recipient") ?? field("Original-Recipient") ?? field("X-Failed-Recipients");
  if (!recipient) {
    for (const m of raw.matchAll(/<?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>?/gi)) {
      const addr = m[1]!.toLowerCase();
      if (own.has(addr) || BOUNCE_SENDER.test(addr) || /@(zoho|zohomail)\./.test(addr)) continue;
      recipient = addr;
      break;
    }
  }
  if (!recipient) return null;
  const diagnostic = /^Diagnostic-Code:\s*(.+)$/im.exec(raw)?.[1]?.trim() ?? /^Status:\s*([45]\.\d+\.\d+)/im.exec(raw)?.[1];
  return { recipient, diagnostic: diagnostic?.slice(0, 300) };
}

/**
 * Record a bounce: the most recent message to that address (last 14 days) becomes BOUNCED, a
 * company contact with that email is marked BOUNCED (so it stops counting as a direct contact),
 * and a hard bounce (5.x.x) adds the address to the outreach suppression list. Transactional
 * sends (verification codes) are never blocked by the suppression list.
 */
export async function recordBounce(recipient: string, diagnostic?: string) {
  const since = new Date(Date.now() - 14 * 86_400_000);
  const msg = await EmailMessage.findOneAndUpdate({ to: recipient, createdAt: { $gte: since }, status: { $in: ["SENT", "DELIVERED"] } }, { $set: { status: "BOUNCED", error: `Bounced${diagnostic ? `: ${diagnostic}` : ""}`.slice(0, 500) } }, { sort: { createdAt: -1 }, new: true }).lean<{ _id: unknown; kind: string }>();
  const hard = !diagnostic || /\b5\.\d+\.\d+\b|\b55\d\b/.test(diagnostic);
  const contacts = hard ? await Contact.updateMany({ type: "EMAIL", value: recipient }, { $set: { emailVerification: "BOUNCED", verified: false, verifiedAt: new Date(), verificationMethod: `Bounce${diagnostic ? `: ${diagnostic.slice(0, 120)}` : ""}` } }) : { modifiedCount: 0 };
  if (hard) await SuppressionEntry.updateOne({ email: recipient }, { $setOnInsert: { email: recipient, reason: "BOUNCE", source: "bounce", note: diagnostic?.slice(0, 200) } }, { upsert: true });
  if (contacts.modifiedCount) {
    const { recomputeCompanyContacts } = await import("@/features/research/contacts");
    const ids = await Contact.distinct("companyId", { type: "EMAIL", value: recipient });
    for (const id of ids) await recomputeCompanyContacts(id);
  }
  return { message: !!msg, kind: msg?.kind, hard, contacts: contacts.modifiedCount };
}
