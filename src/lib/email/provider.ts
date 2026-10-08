/**
 * EmailProvider abstraction. Select with EMAIL_PROVIDER:
 *   console  (default) — logs emails to the server console; nothing is sent.
 *   resend   — Resend HTTP API (EMAIL_API_KEY)
 *   sendgrid — SendGrid v3 HTTP API (EMAIL_API_KEY)
 *
 * Adding SMTP / Amazon SES / Google Workspace = one class implementing
 * EmailProvider, registered in createProvider(). Nothing else changes.
 */
export type OutgoingEmail = {
  to: string;
  toName?: string;
  from: string;
  fromName?: string;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
};

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
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: email.fromName ? `${email.fromName} <${email.from}>` : email.from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: email.headers,
      }),
    });
    if (!res.ok) throw new Error(`Resend error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { id: string };
    return { id: data.id };
  }
}

class SendGridEmailProvider implements EmailProvider {
  id = "sendgrid";
  isLive = true;
  constructor(private apiKey: string) {}
  async send(email: OutgoingEmail) {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: email.to, name: email.toName }] }],
        from: { email: email.from, name: email.fromName },
        subject: email.subject,
        content: [{ type: "text/plain", value: email.text }, ...(email.html ? [{ type: "text/html", value: email.html }] : [])],
        headers: email.headers,
      }),
    });
    if (!res.ok) throw new Error(`SendGrid error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return { id: res.headers.get("x-message-id") ?? `sendgrid-${Date.now()}` };
  }
}

function createProvider(): EmailProvider {
  const kind = (process.env.EMAIL_PROVIDER || "console").toLowerCase();
  const key = process.env.EMAIL_API_KEY || "";
  if (kind === "resend" && key) return new ResendEmailProvider(key);
  if (kind === "sendgrid" && key) return new SendGridEmailProvider(key);
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
  return process.env.EMAIL_FROM || "hello@exploretechify.com";
}
