import nodemailer from "nodemailer";

/**
 * EmailProvider abstraction. Select with EMAIL_PROVIDER:
 *   console   (default) — logs emails to the server console; nothing is sent.
 *   resend    — Resend HTTP API (EMAIL_API_KEY)
 *   sendgrid  — SendGrid v3 HTTP API (EMAIL_API_KEY)
 *   zoho-smtp — Zoho Mail over SMTP (ZOHO_SMTP_* + EMAIL_FROM_ADDRESS, see zohoSmtpConfig)
 *
 * Adding Amazon SES / Google Workspace = one class implementing
 * EmailProvider, registered in createProvider(). Nothing else changes.
 * Server-only: credentials are read from process.env here and nowhere else.
 */
export type OutgoingEmail = {
  to: string;
  toName?: string;
  from: string;
  fromName?: string;
  subject: string;
  text: string;
  html?: string;
  /** Where replies go (e.g. the business inbox when the sending address differs). */
  replyTo?: string;
  headers?: Record<string, string>;
};

/**
 * Typed provider failure. `outcome` tells callers what is known:
 *  - "rejected": the provider answered and refused the message (nothing was sent)
 *  - "unknown":  timeout / network error — the provider may or may not have accepted it
 */
export class EmailProviderError extends Error {
  constructor(
    message: string,
    readonly outcome: "rejected" | "unknown",
    readonly status?: number,
    /** What was refused, when known (SMTP): lets callers give an actionable message. */
    readonly reason?: "auth" | "sender" | "recipient" | "message",
  ) {
    super(message);
    this.name = "EmailProviderError";
  }
}

const SEND_TIMEOUT_MS = Number(process.env.EMAIL_SEND_TIMEOUT_MS || 20_000);

/** fetch with a timeout; network errors and timeouts become "unknown" outcomes. */
async function providerFetch(name: string, url: string, init: RequestInit) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new EmailProviderError(`${name} ${timedOut ? "timed out" : "was unreachable"}`, "unknown");
  }
}

export interface EmailProvider {
  id: string;
  /** False when the provider does not actually deliver mail (console). */
  isLive: boolean;
  send(email: OutgoingEmail): Promise<{ id: string }>;
}

class ConsoleEmailProvider implements EmailProvider {
  id = "console";
  isLive = false;
  async send(email: OutgoingEmail) {
    if (process.env.NODE_ENV !== "test" && process.env.EMAIL_CONSOLE_QUIET !== "true") {
      console.info(`[email:console] (not sent) to=${email.to} subject="${email.subject}"`);
    }
    return { id: `console-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  }
}

class ResendEmailProvider implements EmailProvider {
  id = "resend";
  isLive = true;
  constructor(private apiKey: string) {}
  async send(email: OutgoingEmail) {
    const res = await providerFetch("Resend", "https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: email.fromName ? `${email.fromName} <${email.from}>` : email.from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
        ...(email.replyTo && { reply_to: email.replyTo }),
        headers: email.headers,
      }),
    });
    if (!res.ok) throw new EmailProviderError(`Resend error ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status >= 500 || res.status === 429 ? "unknown" : "rejected", res.status);
    const data = (await res.json()) as { id: string };
    return { id: data.id };
  }
}

class SendGridEmailProvider implements EmailProvider {
  id = "sendgrid";
  isLive = true;
  constructor(private apiKey: string) {}
  async send(email: OutgoingEmail) {
    const res = await providerFetch("SendGrid", "https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: email.to, name: email.toName }] }],
        from: { email: email.from, name: email.fromName },
        subject: email.subject,
        content: [{ type: "text/plain", value: email.text }, ...(email.html ? [{ type: "text/html", value: email.html }] : [])],
        ...(email.replyTo && { reply_to: { email: email.replyTo } }),
        headers: email.headers,
      }),
    });
    if (!res.ok) throw new EmailProviderError(`SendGrid error ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status >= 500 || res.status === 429 ? "unknown" : "rejected", res.status);
    return { id: res.headers.get("x-message-id") ?? `sendgrid-${Date.now()}` };
  }
}

/* ───────────── Zoho Mail (SMTP) ───────────── */

export type ZohoSmtpConfig = { host: string; port: number; secure: boolean; user: string; password: string; fromAddress: string; fromName?: string };

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/**
 * Reads the Zoho SMTP settings. `problems` names what is missing or inconsistent —
 * variable names only, never values, so it is safe to show on the setup page.
 */
export function zohoSmtpConfig(env: Record<string, string | undefined> = process.env): { config?: ZohoSmtpConfig; problems: string[] } {
  const v = (name: string) => env[name]?.trim() ?? "";
  const missing = ["ZOHO_SMTP_HOST", "ZOHO_SMTP_PORT", "ZOHO_SMTP_SECURE", "ZOHO_SMTP_USER", "ZOHO_SMTP_PASSWORD", "EMAIL_FROM_ADDRESS"].filter((n) => !v(n));
  const problems: string[] = [];
  if (missing.length) problems.push(`Missing on the server: ${missing.join(", ")}.`);
  const port = Number(v("ZOHO_SMTP_PORT"));
  const secureRaw = v("ZOHO_SMTP_SECURE").toLowerCase();
  if (v("ZOHO_SMTP_PORT") && port !== 465 && port !== 587) problems.push("ZOHO_SMTP_PORT must be 465 (SSL) or 587 (STARTTLS).");
  if (secureRaw && secureRaw !== "true" && secureRaw !== "false") problems.push("ZOHO_SMTP_SECURE must be true or false.");
  const secure = secureRaw === "true";
  if ((port === 465 && secureRaw === "false") || (port === 587 && secureRaw === "true")) {
    problems.push("ZOHO_SMTP_SECURE does not match ZOHO_SMTP_PORT: use true with 465 (SSL) or false with 587 (STARTTLS).");
  }
  if (v("ZOHO_SMTP_HOST") && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v("ZOHO_SMTP_HOST"))) problems.push("ZOHO_SMTP_HOST must be a hostname only (no scheme or port).");
  if (v("EMAIL_FROM_ADDRESS") && !EMAIL_RE.test(v("EMAIL_FROM_ADDRESS"))) problems.push("EMAIL_FROM_ADDRESS is not a valid email address.");
  if (problems.length) return { problems };
  return {
    config: { host: v("ZOHO_SMTP_HOST"), port, secure, user: v("ZOHO_SMTP_USER"), password: env.ZOHO_SMTP_PASSWORD ?? "", fromAddress: v("EMAIL_FROM_ADDRESS").toLowerCase(), fromName: v("EMAIL_FROM_NAME") || undefined },
    problems: [],
  };
}

type SmtpError = Error & { code?: string; command?: string; responseCode?: number };

/**
 * Maps a Nodemailer error to what is actually known. Only an explicit SMTP reply
 * (auth failure, refused sender/recipient, refused message) proves nothing was sent;
 * timeouts and dropped connections may happen after the server accepted the
 * message, so they are "unknown" and must never be retried automatically.
 * Messages carry codes only — never server text, addresses or credentials.
 */
export function classifySmtpError(err: unknown): EmailProviderError {
  const e = (err ?? {}) as SmtpError;
  const code = typeof e.code === "string" ? e.code : undefined;
  const status = typeof e.responseCode === "number" ? e.responseCode : undefined;
  const command = (e.command ?? "").toUpperCase();
  const label = `Zoho SMTP ${code ?? "error"}${status ? ` ${status}` : ""}`;
  if (code === "EAUTH") return new EmailProviderError(`${label}: authentication failed`, "rejected", status, "auth");
  if (status && status >= 400 && status < 600) {
    if (command.startsWith("MAIL")) return new EmailProviderError(`${label}: sender refused`, "rejected", status, "sender");
    if (command.startsWith("RCPT") || code === "EENVELOPE") return new EmailProviderError(`${label}: recipient refused`, "rejected", status, "recipient");
    if (command === "DATA" || code === "EMESSAGE") return new EmailProviderError(`${label}: message refused`, "rejected", status, "message");
  }
  if (code === "EENVELOPE") return new EmailProviderError(`${label}: recipient refused`, "rejected", status, "recipient");
  return new EmailProviderError(`${label}: ${code === "ETIMEDOUT" ? "timed out" : "connection problem"} — outcome unknown`, "unknown", status);
}

type SmtpTransport = { sendMail(mail: Record<string, unknown>): Promise<{ messageId?: string; accepted?: unknown[]; rejected?: unknown[] }> };

export class ZohoSmtpEmailProvider implements EmailProvider {
  id = "zoho-smtp";
  isLive = true;
  private transport: SmtpTransport;
  constructor(
    private config: ZohoSmtpConfig,
    transport?: SmtpTransport,
  ) {
    this.transport =
      transport ??
      nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure, // true = implicit SSL (465)
        requireTLS: !config.secure, // 587: refuse to continue without STARTTLS
        auth: { user: config.user, pass: config.password },
        tls: { minVersion: "TLSv1.2", servername: config.host },
        connectionTimeout: SEND_TIMEOUT_MS,
        greetingTimeout: SEND_TIMEOUT_MS,
        socketTimeout: SEND_TIMEOUT_MS,
        logger: false,
        debug: false,
      });
  }

  /** The address Zoho will accept as From: the mailbox itself or one of its aliases. */
  get fromAddress() {
    return this.config.fromAddress;
  }

  async send(email: OutgoingEmail) {
    // Zoho refuses a From that isn't the authenticated mailbox or its alias, so the
    // configured address always wins. A different requested sender becomes Reply-To.
    const from = this.config.fromAddress;
    const fromName = this.config.fromName ?? email.fromName;
    const requested = email.replyTo ?? email.from;
    // Reply-To only when it differs from From — a redundant copy is just noise.
    const replyTo = requested.toLowerCase() !== from ? requested : undefined;
    let info: Awaited<ReturnType<SmtpTransport["sendMail"]>>;
    try {
      info = await this.transport.sendMail({
        from: fromName ? { name: fromName, address: from } : from,
        to: email.toName ? { name: email.toName, address: email.to } : email.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
        ...(replyTo && { replyTo }),
        headers: email.headers,
      });
    } catch (err) {
      throw classifySmtpError(err);
    }
    if (info.rejected?.length || !info.accepted?.length) throw new EmailProviderError("Zoho SMTP: recipient refused", "rejected", undefined, "recipient");
    return { id: info.messageId ?? `zoho-${Date.now()}` };
  }
}

/** Configuration problems for the selected provider (names only, no secret values). */
export function emailProviderSetupProblems(): string[] {
  const kind = (process.env.EMAIL_PROVIDER || "console").toLowerCase();
  if (kind === "zoho-smtp") return zohoSmtpConfig().problems;
  if ((kind === "resend" || kind === "sendgrid") && !process.env.EMAIL_API_KEY) return ["Missing on the server: EMAIL_API_KEY."];
  if (kind === "console") return ["EMAIL_PROVIDER is not set (or is \"console\"). Set EMAIL_PROVIDER=zoho-smtp and the ZOHO_SMTP_* settings."];
  if (kind !== "resend" && kind !== "sendgrid") return [`EMAIL_PROVIDER="${kind}" is not supported. Use zoho-smtp, resend or sendgrid.`];
  return [];
}

/** The fixed From identity when the provider dictates it (Zoho SMTP), else null. */
export function providerSenderIdentity(): { address: string; name?: string } | null {
  if ((process.env.EMAIL_PROVIDER || "").toLowerCase() !== "zoho-smtp") return null;
  const { config } = zohoSmtpConfig();
  return config ? { address: config.fromAddress, name: config.fromName } : null;
}

function createProvider(): EmailProvider {
  const kind = (process.env.EMAIL_PROVIDER || "console").toLowerCase();
  const key = process.env.EMAIL_API_KEY || "";
  if (kind === "resend" && key) return new ResendEmailProvider(key);
  if (kind === "sendgrid" && key) return new SendGridEmailProvider(key);
  if (kind === "zoho-smtp") {
    const { config } = zohoSmtpConfig();
    if (config) return new ZohoSmtpEmailProvider(config);
  }
  if (kind !== "console") console.warn(`[email] EMAIL_PROVIDER="${kind}" is not configured — falling back to console.`);
  return new ConsoleEmailProvider();
}

const g = globalThis as unknown as { __etEmail?: EmailProvider };
export function getEmailProvider(): EmailProvider {
  g.__etEmail ??= createProvider();
  return g.__etEmail;
}

/** Test hook. */
export function setEmailProvider(provider: EmailProvider) {
  g.__etEmail = provider;
}

export function defaultFromAddress() {
  return providerSenderIdentity()?.address || process.env.EMAIL_FROM || "hello@exploretechify.com";
}
