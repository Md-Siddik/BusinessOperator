import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Company, CrmActivity, EmailMessage, SuppressionEntry, type CompanyDoc, type EmailMessageDoc } from "@/models";
import type { SessionUser } from "@/lib/auth/actor";
import type { Actor } from "@/lib/permissions";
import { expectRejects, makeTenants } from "./helpers";

/**
 * Owner-only Email Sender. A mocked provider is installed for every test —
 * no real email is ever sent.
 */
vi.hoisted(() => {
  // The unsubscribe link must be public https for sending to be allowed (read at import time).
  process.env.NEXT_PUBLIC_SITE_URL = "https://exploretechify.com";
});
const session = vi.hoisted(() => ({ current: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => session.current,
  getActor: async () => session.current?.actor ?? null,
}));

const { setEmailProvider, EmailProviderError, ZohoSmtpEmailProvider, zohoSmtpConfig, classifySmtpError } = await import("@/lib/email/provider");
const service = await import("@/features/email-sender/service");
const { resetRateLimits } = await import("@/lib/rate-limit");
const { DEFAULT_TEMPLATE, defaultTemplateContent, renderEmail } = await import("@/features/email-sender/template");
const { POST: sendRoute } = await import("@/app/api/email-sender/send/route");
const { POST: previewRoute } = await import("@/app/api/email-sender/preview/route");
const { GET: historyRoute } = await import("@/app/api/email-sender/history/route");

type Sent = { to: string; from: string; subject: string; text: string; html?: string; replyTo?: string; headers?: Record<string, string> };
const sent: Sent[] = [];
let failNext: Error | null = null;
function installProvider(live = true) {
  setEmailProvider({
    id: live ? "test-provider" : "console",
    isLive: live,
    async send(email) {
      if (failNext) {
        const e = failNext;
        failNext = null;
        throw e;
      }
      sent.push(email);
      return { id: `msg-${sent.length}` };
    },
  });
}

/** Runs fn with env overrides, then restores the previous values. */
async function withEnv(vars: Record<string, string>, fn: () => unknown) {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

let t: Awaited<ReturnType<typeof makeTenants>>;
let n = 0;
const key = () => `test-key-${Date.now()}-${++n}-abcdefgh`;
const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(new URL(url, "http://localhost:3000"), init);
const ctx = { params: Promise.resolve({}) };
const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
function as(user: { actor: Actor } | null) {
  session.current = user ? { id: user.actor.id, name: user.actor.name, email: user.actor.email, role: user.actor.role, status: "ACTIVE", organizationId: user.actor.organizationId, organizationStatus: "ACTIVE", actor: user.actor } : null;
}

beforeAll(async () => {
  t = await makeTenants();
});
beforeEach(() => {
  sent.length = 0;
  failNext = null;
  installProvider(true);
  process.env.EMAIL_SENDER_COOLDOWN_MINUTES = "0";
  process.env.EMAIL_SENDER_HOURLY_LIMIT = "1000";
  process.env.EMAIL_SENDER_DAILY_LIMIT = "1000";
});

describe("Owner-only authorization", () => {
  const calls: [string, (a: Actor | null) => unknown][] = [
    ["getSenderStatus", (a) => service.getSenderStatus(a)],
    ["previewEmail", (a) => service.previewEmail(a, { mode: "TEMPLATE" })],
    ["getDefaultTemplate", (a) => service.getDefaultTemplate(a)],
    ["sendEmail", (a) => service.sendEmail(a, { mode: "TEMPLATE", to: "someone@example.test", idempotencyKey: key() })],
    ["listSentEmails", (a) => service.listSentEmails(a)],
  ];

  it.each(calls)("%s: 401 without a user, 403 for ADMIN / STAFF / CLIENT", async (_n, call) => {
    await expectRejects(Promise.resolve().then(() => call(null)), 401);
    for (const u of [t.admin, t.staff, t.clientA]) await expectRejects(Promise.resolve().then(() => call(u.actor)), 403);
    expect(sent).toHaveLength(0);
  });

  it("direct API requests cannot bypass the role check", async () => {
    as(null);
    expect((await sendRoute(req("/api/email-sender/send", json({ mode: "TEMPLATE", to: "x@example.test", idempotencyKey: key() })), ctx)).status).toBe(401);
    expect((await historyRoute(req("/api/email-sender/history"), ctx)).status).toBe(401);
    for (const u of [t.admin, t.staff, t.clientA]) {
      as(u);
      const r = await sendRoute(req("/api/email-sender/send", json({ mode: "TEMPLATE", to: "x@example.test", idempotencyKey: key(), isOwner: true, role: "OWNER" })), ctx);
      expect(r.status).toBe(403);
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe("FORBIDDEN");
      expect((await previewRoute(req("/api/email-sender/preview", json({ mode: "TEMPLATE" })), ctx)).status).toBe(403);
      expect((await historyRoute(req("/api/email-sender/history"), ctx)).status).toBe(403);
    }
    expect(sent).toHaveLength(0);
    expect(await EmailMessage.countDocuments({ kind: "DIRECT", to: "x@example.test" })).toBe(0);
  });

  it("the Owner can preview, send and read history through the API", async () => {
    as(t.owner);
    expect((await previewRoute(req("/api/email-sender/preview", json({ mode: "TEMPLATE", to: "lead@example.test" })), ctx)).status).toBe(200);
    const r = await sendRoute(req("/api/email-sender/send", json({ mode: "TEMPLATE", to: "lead@example.test", idempotencyKey: key() })), ctx);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ status: "SENT", accepted: true, provider: "test-provider" });
    expect(sent).toHaveLength(1);
    const h = (await (await historyRoute(req("/api/email-sender/history"), ctx)).json()) as { items: { to: string; status: string }[] };
    expect(h.items[0]).toMatchObject({ to: "lead@example.test", status: "SENT" });
  });
});

describe("Fixed template", () => {
  type Sig = { name: string; email?: string; phone?: string; postalAddress?: string };
  const render = (signature: Sig = { name: "Jane Doe", email: "jane@exploretechify.com" }) => renderEmail(defaultTemplateContent(), { unsubscribeUrl: "https://exploretechify.com/unsubscribe?token=abc", signature });

  it("renders the positioning email: honest subject, brand header, tagline, focus areas, services, one button, signature and opt-out", () => {
    const r = render();
    expect(r.subject).toBe("A website built to turn visitors into customers");
    expect(r.subject).not.toMatch(/^(re|fwd?):|\||!/i);
    for (const s of ["Hello,", "Websites That Turn Visitors Into Customers.", "Business Websites &amp; Digital Growth", "What we focus on", "Beyond the website", "SEO and digital visibility", "ongoing collaboration", "longer-term growth partnership", "See How We Can Help", "Website</span>", "Customers</span>", 'href="mailto:hello@exploretechify.com"', "Best regards,", "Jane Doe", 'href="mailto:jane@exploretechify.com"', 'href="https://exploretechify.com/"', "unsubscribe?token=abc", "simply reply and let us know"]) expect(r.html).toContain(s);
    for (const s of ["Websites That Turn Visitors Into Customers.", "Hello,", "WHAT WE FOCUS ON", "Website → Visitors → Enquiries → Customers", "• Attract: Help the right people", "SEO and digital visibility", "See How We Can Help: https://exploretechify.com/", "--\nExploreTechify\nWebsites That Turn Visitors Into Customers.\nhttps://exploretechify.com/\nhello@exploretechify.com","Best regards,\nJane Doe\nExploreTechify · Business Websites & Digital Growth\nWeb: exploretechify.com\nEmail: jane@exploretechify.com", "unsubscribe here: https://exploretechify.com/unsubscribe?token=abc"]) expect(r.text).toContain(s);
    expect(r.text).not.toMatch(/<[a-z][^>]*>|\*\*|^##/im);
    // Exactly one button, and no promises of results.
    expect(r.html.match(/See How We Can Help/g)).toHaveLength(1);
    // The Website → … → Customers flow is drawn as four pills.
    expect(r.html.match(/border-radius:999px/g)).toHaveLength(4);
    expect(`${r.subject} ${DEFAULT_TEMPLATE.body}`).not.toMatch(/guarantee|10x|!|free|limited time|act now|shareholder|equity/i);
  });

  it("is email-client safe: tables + inline CSS, Outlook fallback, no scripts, images, external CSS, hidden text or tracking", () => {
    const { html } = render();
    expect(html).toMatch(/<table role="presentation"/);
    expect(html).toContain("<!--[if mso]>");
    expect(html).toContain("max-width:600px");
    expect(html).not.toMatch(/<script|<img|<link|@import|url\(|javascript:|display:\s*none|visibility:\s*hidden|max-height:\s*0|font-size:\s*1px|opacity:\s*0|<svg|<form|<iframe/i);
    // Only our own links: the button, header and signature website links, the reply address, and the opt-out.
    for (const href of html.match(/href="[^"]+"/g) ?? []) expect(href).toMatch(/^href="(https:\/\/exploretechify\.com\/(unsubscribe\?token=abc)?|mailto:(jane|hello)@exploretechify\.com)"$/);
    // The four focus areas are cards that stack on phones.
    expect(html.match(/<td class="et-col"/g)).toHaveLength(4);
    // Lightweight: far under Gmail's ~102 KB clipping limit.
    expect(html.length).toBeLessThan(20_000);
  });

  it("the HTML and plain-text parts carry the same words", () => {
    const { html, text } = render();
    const decode = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#0?39;|&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&rarr;/g, "→").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const norm = (s: string) => s.replace(/:/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    for (const line of DEFAULT_TEMPLATE.body.split("\n").filter(Boolean)) {
      const words = norm(line.replace(/^##\s+|^-\s+/, "").replace(/\*\*/g, ""));
      expect(norm(text)).toContain(words);
      expect(norm(decode(html))).toContain(words);
    }
  });

  it("headings and highlight cards are built from escaped text, so custom messages can't inject HTML", () => {
    const r = renderEmail({ subject: "Hi", body: "## <b>Plan</b>\n\n- **<i>One</i>**: <script>x</script>\n- **Two**: second\n- **Three**: third\n\n- plain item\n- **Bold**: mixed with\n- a normal item" }, { unsubscribeUrl: "https://exploretechify.com/unsubscribe?token=abc", signature: { name: "Jane" } });
    expect(r.html).toContain("&lt;b&gt;Plan&lt;/b&gt;</h2>");
    expect(r.html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(r.html).not.toMatch(/<script|<i>|<b>/);
    // Three highlights → two rows (the odd one gets an empty partner cell); a mixed list stays a bullet list.
    expect(r.html.match(/<td class="et-col"/g)).toHaveLength(4);
    expect(r.html).toContain("<li");
    expect(r.text).toContain("<B>PLAN</B>");
    expect(r.text).toContain("• <i>One</i>: <script>x</script>");
  });

  it("escapes the signature and adds the optional phone and postal address only when configured", () => {
    const plain = render({ name: "Jane Doe" });
    // No signature email row (the footer's business address is always shown).
    expect(plain.html).not.toMatch(/>Email<\/td>/);
    expect(plain.text).not.toMatch(/Phone:|Email:/);
    const r = render({ name: "Jane <b>Doe</b>", email: "jane@exploretechify.com", phone: "+47 400 00 000", postalAddress: "1 Example Street, Oslo" });
    expect(r.html).toContain("Jane &lt;b&gt;Doe&lt;/b&gt;");
    for (const s of ["+47 400 00 000", "1 Example Street, Oslo"]) {
      expect(r.text).toContain(s);
      expect(r.html).toContain(s);
    }
  });

  it("valid recipients send through the configured provider with multipart, reply-to and unsubscribe headers", async () => {
    const res = await service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to: "Founder@Example.test", idempotencyKey: key() });
    expect(res.status).toBe("SENT");
    expect(sent).toHaveLength(1);
    const m = sent[0]!;
    expect(m.to).toBe("founder@example.test");
    expect(m.subject).toBe(DEFAULT_TEMPLATE.subject);
    expect(m.html).toContain("Best regards,");
    expect(m.text).toContain("Hello,");
    expect(m.replyTo).toBe("hello@exploretechify.com");
    expect(m.headers?.["List-Unsubscribe"]).toContain("https://exploretechify.com/api/email/unsubscribe?token=");
    // Only standards-based headers: no Precedence/X-Priority/classification tricks.
    expect(Object.keys(m.headers ?? {}).sort()).toEqual(["List-Unsubscribe", "List-Unsubscribe-Post"]);
    const rec = await EmailMessage.findById(res.id).lean<EmailMessageDoc>();
    expect(rec).toMatchObject({ kind: "DIRECT", mode: "TEMPLATE", status: "SENT", provider: "test-provider", providerMessageId: "msg-1" });
    expect(rec?.body).toBe("[template default-v8]");
    expect(rec?.deliveredAt ?? null).toBeNull();
  });

  it("invalid recipients are rejected before anything is sent", async () => {
    for (const to of ["not-an-email", "a@b", "", "x@example.test\nBcc: victim@example.test"]) await expectRejects(service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to, idempotencyKey: key() }), 400);
    expect(sent).toHaveLength(0);
  });
});

describe("Website analytics link", () => {
  it("tags the button link with the campaign (never the recipient) so Website Analytics can credit outreach", async () => {
    const preview = await service.previewEmail(t.owner.actor, { mode: "TEMPLATE", templateId: "general", locale: "en" });
    expect(preview.html).toContain("https://exploretechify.com/?utm_source=email&amp;utm_medium=outreach&amp;utm_campaign=outreach-general");
    expect(preview.text).toContain("See How We Can Help: https://exploretechify.com/?utm_source=email&utm_medium=outreach&utm_campaign=outreach-general");
    expect(preview.html).not.toMatch(/utm_[a-z]+=[^&"]*@/);
    const custom = await service.previewEmail(t.owner.actor, { mode: "CUSTOM", subject: "Hello", body: "Hi,\n\nSee https://exploretechify.com/services", includeCta: true });
    expect(custom.html).toContain("utm_campaign=outreach-custom");
    expect(custom.html).toContain('<a href="https://exploretechify.com/services"');
  });
});

describe("Custom email", () => {
  it("sends the Owner's subject and body, escaping any HTML", async () => {
    const body = 'Hello Anna,\n\n<script>alert("x")</script> <img src=x onerror=alert(1)>\n\n- **Point one**\n- javascript:alert(1)\n\nSee https://exploretechify.com/services';
    await service.sendEmail(t.owner.actor, { mode: "CUSTOM", to: "anna@example.test", subject: "Quick question\r\nBcc: x@y.z", body, includeCta: false, idempotencyKey: key() });
    const m = sent[0]!;
    expect(m.subject).toBe("Quick question Bcc: x@y.z");
    expect(m.html).not.toContain("<script");
    expect(m.html).not.toContain("<img");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).not.toMatch(/href="javascript:/i);
    expect(m.html).toContain('<a href="https://exploretechify.com/services"');
    expect(m.html).toContain("<strong");
    expect(m.html).not.toContain("More about ExploreTechify");
    expect(m.text).toContain("• Point one");
    const rec = await EmailMessage.findOne({ to: "anna@example.test" }).lean<EmailMessageDoc>();
    expect(rec?.mode).toBe("CUSTOM");
    expect(rec?.body).not.toContain("Anna");
  });

  it("rejects empty and oversized fields", async () => {
    const base = { mode: "CUSTOM", to: "b@example.test", includeCta: true };
    await expectRejects(service.sendEmail(t.owner.actor, { ...base, subject: "", body: "A long enough message", idempotencyKey: key() }), 400);
    await expectRejects(service.sendEmail(t.owner.actor, { ...base, subject: "Hello there", body: "  ", idempotencyKey: key() }), 400);
    await expectRejects(service.sendEmail(t.owner.actor, { ...base, subject: "x".repeat(201), body: "A long enough message", idempotencyKey: key() }), 400);
    await expectRejects(service.sendEmail(t.owner.actor, { ...base, subject: "Hello there", body: "y".repeat(10_001), idempotencyKey: key() }), 400);
    expect(sent).toHaveLength(0);
  });

  it("custom sends never change the default template", async () => {
    const before = JSON.stringify(service.getDefaultTemplate(t.owner.actor));
    await service.sendEmail(t.owner.actor, { mode: "CUSTOM", to: "c@example.test", subject: "Changed subject", body: "Changed body text here", includeCta: true, idempotencyKey: key() });
    expect(JSON.stringify(service.getDefaultTemplate(t.owner.actor))).toBe(before);
    expect((await service.previewEmail(t.owner.actor, { mode: "TEMPLATE" })).subject).toBe(DEFAULT_TEMPLATE.subject);
  });
});

describe("Delivery, failures and abuse protection", () => {
  it("missing provider configuration is an actionable error, never a success", async () => {
    installProvider(false);
    const status = service.getSenderStatus(t.owner.actor);
    expect(status.configured).toBe(false);
    expect(status.problems.join(" ")).toContain("EMAIL_PROVIDER");
    as(t.owner);
    const r = await sendRoute(req("/api/email-sender/send", json({ mode: "TEMPLATE", to: "d@example.test", idempotencyKey: key() })), ctx);
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("NOT_CONFIGURED");
    expect(sent).toHaveLength(0);
    expect(await EmailMessage.countDocuments({ to: "d@example.test" })).toBe(0);
  });

  it("a provider rejection is reported as a failure and never leaks provider details", async () => {
    failNext = new EmailProviderError("Resend error 403: The domain is not verified. key=re_SECRET_123", "rejected", 403);
    as(t.owner);
    const r = await sendRoute(req("/api/email-sender/send", json({ mode: "TEMPLATE", to: "e@example.test", idempotencyKey: key() })), ctx);
    expect(r.status).toBe(400);
    const text = await r.text();
    expect(text).toContain("PROVIDER_REJECTED");
    expect(text).not.toContain("re_SECRET_123");
    const rec = await EmailMessage.findOne({ to: "e@example.test" }).lean<EmailMessageDoc>();
    expect(rec?.status).toBe("FAILED");
    expect(rec?.error).not.toContain("SECRET");
  });

  it("timeouts are 'outcome unknown' and pause re-sends to that address for the cooldown", async () => {
    process.env.EMAIL_SENDER_COOLDOWN_MINUTES = "60";
    failNext = new EmailProviderError("Resend timed out", "unknown");
    await expectRejects(service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to: "f@example.test", idempotencyKey: key() }), 400);
    expect((await EmailMessage.findOne({ to: "f@example.test" }).lean<EmailMessageDoc>())?.error).toContain("outcome unknown");
    await expectRejects(service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to: "f@example.test", idempotencyKey: key() }), 429);
    expect(sent).toHaveLength(0);
  });

  it("a repeated submission (same request key) never sends twice", async () => {
    const k = key();
    const first = await service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to: "g@example.test", idempotencyKey: k });
    const second = await service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to: "g@example.test", idempotencyKey: k });
    expect(second).toMatchObject({ id: first.id, duplicate: true });
    expect(sent).toHaveLength(1);
    expect(await EmailMessage.countDocuments({ to: "g@example.test" })).toBe(1);
  });

  it("cooldown blocks a second email to the same address", async () => {
    process.env.EMAIL_SENDER_COOLDOWN_MINUTES = "60";
    await service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to: "h@example.test", idempotencyKey: key() });
    await expectRejects(service.sendEmail(t.owner.actor, { mode: "CUSTOM", to: "h@example.test", subject: "Follow up", body: "Another message body", includeCta: false, idempotencyKey: key() }), 429);
    expect(sent).toHaveLength(1);
  });

  it("hourly and daily limits apply", async () => {
    process.env.EMAIL_SENDER_DAILY_LIMIT = "0";
    await expectRejects(service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to: "i@example.test", idempotencyKey: key() }), 429);
    process.env.EMAIL_SENDER_DAILY_LIMIT = "1000";
    process.env.EMAIL_SENDER_HOURLY_LIMIT = "1";
    // A fresh owner id is not needed: the hourly bucket already holds earlier sends from this owner.
    await expectRejects(service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to: "j@example.test", idempotencyKey: key() }), 429);
    expect(sent).toHaveLength(0);
  });

  it("the setup warning names missing Zoho SMTP settings without exposing values", async () => {
    await withEnv({ EMAIL_PROVIDER: "zoho-smtp", ZOHO_SMTP_HOST: "", ZOHO_SMTP_PORT: "465", ZOHO_SMTP_SECURE: "true", ZOHO_SMTP_PASSWORD: "hunter2-SECRET", ZOHO_SMTP_USER: "", EMAIL_FROM_ADDRESS: "" }, () => {
      installProvider(false);
      const status = service.getSenderStatus(t.owner.actor);
      expect(status.configured).toBe(false);
      const text = status.problems.join(" ");
      for (const name of ["ZOHO_SMTP_HOST", "ZOHO_SMTP_USER", "EMAIL_FROM_ADDRESS"]) expect(text).toContain(name);
      expect(text).not.toContain("ZOHO_SMTP_PASSWORD");
      expect(JSON.stringify(status)).not.toContain("hunter2");
    });
  });

  it("opted-out recipients and suppressed domains are never emailed", async () => {
    await SuppressionEntry.create({ email: "optout@example.test", reason: "OPT_OUT" });
    await SuppressionEntry.create({ domain: "blocked.example", reason: "DO_NOT_CONTACT" });
    await expectRejects(service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to: "optout@example.test", idempotencyKey: key() }), 400);
    await expectRejects(service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to: "anyone@blocked.example", idempotencyKey: key() }), 400);
    expect(sent).toHaveLength(0);
  });
});

describe("Zoho SMTP provider (mocked transport — no real SMTP connection)", () => {
  const ZOHO = { EMAIL_PROVIDER: "zoho-smtp", ZOHO_SMTP_HOST: "smtp.example-zoho.test", ZOHO_SMTP_PORT: "465", ZOHO_SMTP_SECURE: "true", ZOHO_SMTP_USER: "owner@example.test", ZOHO_SMTP_PASSWORD: "app-pass-SECRET-42", EMAIL_FROM_ADDRESS: "Owner@Example.test", EMAIL_FROM_NAME: "Owner Name" };
  const smtpErr = (code: string, command?: string, responseCode?: number) => Object.assign(new Error(`SMTP failure, pass=${ZOHO.ZOHO_SMTP_PASSWORD}`), { code, command, responseCode });

  type Mail = Record<string, unknown>;
  function fakeTransport(behaviour: (mail: Mail) => Promise<{ messageId?: string; accepted?: unknown[]; rejected?: unknown[] }>) {
    const calls: Mail[] = [];
    return { calls, transport: { sendMail: (mail: Mail) => (calls.push(mail), behaviour(mail)) } };
  }
  const config = () => zohoSmtpConfig({ ...ZOHO }).config!;

  it("validates configuration: names only, and SSL/STARTTLS port pairing", () => {
    expect(zohoSmtpConfig({ ...ZOHO }).problems).toEqual([]);
    expect(zohoSmtpConfig({ ...ZOHO, ZOHO_SMTP_PORT: "587", ZOHO_SMTP_SECURE: "false" }).config).toMatchObject({ port: 587, secure: false });
    const missing = zohoSmtpConfig({ EMAIL_PROVIDER: "zoho-smtp" }).problems.join(" ");
    for (const n of ["ZOHO_SMTP_HOST", "ZOHO_SMTP_PORT", "ZOHO_SMTP_SECURE", "ZOHO_SMTP_USER", "ZOHO_SMTP_PASSWORD", "EMAIL_FROM_ADDRESS"]) expect(missing).toContain(n);
    expect(zohoSmtpConfig({ ...ZOHO, ZOHO_SMTP_PORT: "465", ZOHO_SMTP_SECURE: "false" }).config).toBeUndefined();
    expect(zohoSmtpConfig({ ...ZOHO, ZOHO_SMTP_PORT: "587", ZOHO_SMTP_SECURE: "true" }).config).toBeUndefined();
    expect(zohoSmtpConfig({ ...ZOHO, ZOHO_SMTP_PORT: "25" }).config).toBeUndefined();
    expect(zohoSmtpConfig({ ...ZOHO, ZOHO_SMTP_HOST: "https://smtp.zoho.com:465" }).config).toBeUndefined();
    expect(zohoSmtpConfig({ ...ZOHO, EMAIL_FROM_ADDRESS: "not an email" }).config).toBeUndefined();
    const bad = zohoSmtpConfig({ ...ZOHO, ZOHO_SMTP_PORT: "465", ZOHO_SMTP_SECURE: "false", EMAIL_FROM_ADDRESS: "x" }).problems.join(" ");
    expect(bad).not.toContain(ZOHO.ZOHO_SMTP_PASSWORD);
    expect(bad).not.toContain(ZOHO.ZOHO_SMTP_USER);
  });

  it("configures Nodemailer for SSL on 465 and enforced STARTTLS on 587", () => {
    const opts = (p: InstanceType<typeof ZohoSmtpEmailProvider>) => (p as unknown as { transport: { options: Record<string, unknown> } }).transport.options;
    const ssl = opts(new ZohoSmtpEmailProvider(config()));
    expect(ssl).toMatchObject({ host: "smtp.example-zoho.test", port: 465, secure: true, requireTLS: false, logger: false, debug: false });
    const starttls = opts(new ZohoSmtpEmailProvider(zohoSmtpConfig({ ...ZOHO, ZOHO_SMTP_PORT: "587", ZOHO_SMTP_SECURE: "false" }).config!));
    expect(starttls).toMatchObject({ port: 587, secure: false, requireTLS: true });
  });

  it("always sends from the configured Zoho mailbox, with multipart content and headers", async () => {
    const { calls, transport } = fakeTransport(async (m) => ({ messageId: "<abc@zoho>", accepted: [m.to], rejected: [] }));
    const p = new ZohoSmtpEmailProvider(config(), transport);
    const res = await p.send({ to: "lead@example.test", from: "someone-else@exploretechify.com", fromName: "Other", subject: "Hi", text: "Hello", html: "<p>Hello</p>", headers: { "List-Unsubscribe": "<https://x>" } });
    expect(res.id).toBe("<abc@zoho>");
    expect(calls[0]).toMatchObject({ from: { name: "Owner Name", address: "owner@example.test" }, to: "lead@example.test", replyTo: "someone-else@exploretechify.com", text: "Hello", html: "<p>Hello</p>", headers: { "List-Unsubscribe": "<https://x>" } });
  });

  it.each([
    ["authentication failure", smtpErr("EAUTH", "AUTH PLAIN", 535), "rejected", "auth"],
    ["sender refused", smtpErr("EENVELOPE", "MAIL FROM", 553), "rejected", "sender"],
    ["recipient refused", smtpErr("EENVELOPE", "RCPT TO", 550), "rejected", "recipient"],
    ["message refused", smtpErr("EMESSAGE", "DATA", 554), "rejected", "message"],
    ["connection timeout", smtpErr("ETIMEDOUT", "CONN"), "unknown", undefined],
    ["socket timeout after DATA", smtpErr("ETIMEDOUT", "DATA"), "unknown", undefined],
    ["dropped connection", smtpErr("ECONNECTION"), "unknown", undefined],
    ["unexpected error", new Error("boom"), "unknown", undefined],
  ])("classifies %s safely and without leaking secrets", (_n, err, outcome, reason) => {
    const e = classifySmtpError(err);
    expect(e.outcome).toBe(outcome);
    expect(e.reason).toBe(reason);
    expect(e.message).not.toContain("SECRET");
  });

  it("a recipient missing from the accepted list is a rejection, not a success", async () => {
    const { transport } = fakeTransport(async () => ({ messageId: "x", accepted: [], rejected: ["lead@example.test"] }));
    await expect(new ZohoSmtpEmailProvider(config(), transport).send({ to: "lead@example.test", from: "owner@example.test", subject: "s", text: "t" })).rejects.toMatchObject({ outcome: "rejected", reason: "recipient" });
  });

  it("through the Email Sender: uses the Zoho identity, explains auth failures, and never retries an unknown outcome", async () => {
    await withEnv({ ...ZOHO, EMAIL_SENDER_FROM: "hello@exploretechify.com", EMAIL_SENDER_COOLDOWN_MINUTES: "60" }, async () => {
      expect(service.senderSettings()).toMatchObject({ from: "owner@example.test", fromName: "Owner Name", replyTo: "owner@example.test" });

      // Accepted
      let fake = fakeTransport(async (m) => ({ messageId: "<ok@zoho>", accepted: [m.to] }));
      setEmailProvider(new ZohoSmtpEmailProvider(config(), fake.transport));
      expect(service.getSenderStatus(t.owner.actor)).toMatchObject({ configured: true, provider: "zoho-smtp", from: "owner@example.test" });
      const ok = await service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to: "zoho-ok@example.test", idempotencyKey: key() });
      expect(ok).toMatchObject({ status: "SENT", provider: "zoho-smtp", providerMessageId: "<ok@zoho>" });
      expect((await EmailMessage.findById(ok.id).lean<EmailMessageDoc>())?.from).toBe("owner@example.test");
      // Replies go to the sending mailbox itself, so no redundant Reply-To header; signed with the From name.
      expect(fake.calls[0]).toMatchObject({ from: { name: "Owner Name", address: "owner@example.test" } });
      expect(fake.calls[0]!.replyTo).toBeUndefined();
      expect(fake.calls[0]!.text).toContain("Best regards,\nOwner Name\nExploreTechify");
      expect(String((fake.calls[0]!.headers as Record<string, string>)["List-Unsubscribe"])).toContain("mailto:owner@example.test");

      // Authentication failure: actionable, no secrets in the response or history
      fake = fakeTransport(async () => Promise.reject(smtpErr("EAUTH", "AUTH PLAIN", 535)));
      setEmailProvider(new ZohoSmtpEmailProvider(config(), fake.transport));
      as(t.owner);
      const r = await sendRoute(req("/api/email-sender/send", json({ mode: "TEMPLATE", to: "zoho-auth@example.test", idempotencyKey: key() })), ctx);
      expect(r.status).toBe(400);
      const body = await r.text();
      expect(body).toContain("PROVIDER_REJECTED");
      expect(body).toContain("ZOHO_SMTP_PASSWORD");
      expect(body).not.toContain("SECRET");
      const rec = await EmailMessage.findOne({ to: "zoho-auth@example.test" }).lean<EmailMessageDoc>();
      expect(rec).toMatchObject({ status: "FAILED", error: "Provider rejected the message: sign-in failed (SMTP 535)" });

      // Timeout: exactly one attempt, recorded as unknown, re-send blocked by cooldown
      fake = fakeTransport(async () => Promise.reject(smtpErr("ETIMEDOUT", "DATA")));
      setEmailProvider(new ZohoSmtpEmailProvider(config(), fake.transport));
      const k = key();
      await expectRejects(service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to: "zoho-timeout@example.test", idempotencyKey: k }), 400);
      expect(fake.calls).toHaveLength(1);
      expect((await EmailMessage.findOne({ to: "zoho-timeout@example.test" }).lean<EmailMessageDoc>())?.error).toContain("outcome unknown");
      await expectRejects(service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to: "zoho-timeout@example.test", idempotencyKey: k }), 409);
      await expectRejects(service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to: "zoho-timeout@example.test", idempotencyKey: key() }), 429);
      expect(fake.calls).toHaveLength(1);
    });
  });
});

describe("Company Intelligence: Quick Send and Custom email", () => {
  let seq = 0;
  async function company(extra: Record<string, unknown> = {}) {
    const c = await Company.create({ companyName: `Quick Send Test ${++seq} AS`, countryCode: "NO", source: "manual-test", sourceId: `qs-${Date.now()}-${seq}`, email: `info${seq}@company.test`, ...extra });
    return { id: String(c._id), email: `info${seq}@company.test` };
  }

  it("Quick Send sends the chosen default template to the company and marks it contacted", async () => {
    const c = await company();
    as(t.owner);
    // Without a template choice Quick Send suggests one for the company (see outreach-email.test.ts);
    // the general English template is still available and unchanged.
    const r = await sendRoute(req("/api/email-sender/send", json({ mode: "TEMPLATE", templateId: "general", locale: "en", to: c.email, companyId: c.id, idempotencyKey: key() })), ctx);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { status: string; company: { stage: string; lastContactedAt: string } };
    expect(body).toMatchObject({ status: "SENT", company: { stage: "CONTACTED" } });
    // Exactly the Email Sender's template — same renderer, same subject and body.
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(c.email);
    expect(sent[0]!.subject).toBe(DEFAULT_TEMPLATE.subject);
    // Every paragraph of the default template body is in the sent email.
    for (const para of DEFAULT_TEMPLATE.body.split(/\n{2,}/).filter((x) => !/^(##|-)/.test(x))) expect(sent[0]!.text).toContain(para.replace(/\*\*/g, ""));
    const doc = await Company.findById(c.id).lean<CompanyDoc>();
    expect(doc?.lead?.stage).toBe("CONTACTED");
    expect(doc?.lead?.lastContactedAt).toBeInstanceOf(Date);
    const rec = await EmailMessage.findOne({ to: c.email }).lean<EmailMessageDoc>();
    expect(rec).toMatchObject({ kind: "DIRECT", mode: "TEMPLATE", status: "SENT", countryCode: "NO" });
    expect(String(rec?.companyId)).toBe(c.id);
    expect(rec?.body).toMatch(/^\[template /);
    expect(await CrmActivity.countDocuments({ companyId: c.id, type: "EMAIL" })).toBe(1);
  });

  it("Custom email sends the Owner's subject and message through the same path", async () => {
    const c = await company();
    const r = await service.sendEmail(t.owner.actor, { mode: "CUSTOM", to: c.email, companyId: c.id, subject: "Hello from ExploreTechify", body: "A short personal note about your new company.", includeCta: true, idempotencyKey: key() });
    expect(r.company?.stage).toBe("CONTACTED");
    expect(sent[0]).toMatchObject({ to: c.email, subject: "Hello from ExploreTechify" });
    expect(sent[0]!.text).toContain("A short personal note about your new company.");
    const rec = await EmailMessage.findOne({ to: c.email }).lean<EmailMessageDoc>();
    expect(rec).toMatchObject({ mode: "CUSTOM", subject: "Hello from ExploreTechify" });
    expect(rec?.body).not.toContain("personal note");
  });

  it("does not move a lead backwards: a later stage is kept, only the last-contacted date changes", async () => {
    const c = await company({ lead: { stage: "MEETING" } });
    const r = await service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to: c.email, companyId: c.id, idempotencyKey: key() });
    expect(r.company?.stage).toBe("MEETING");
    expect((await Company.findById(c.id).lean<CompanyDoc>())?.lead?.stage).toBe("MEETING");
  });

  it("Admin, Staff, Client and anonymous users cannot send for a company, and nothing is tracked", async () => {
    resetRateLimits();
    const c = await company();
    as(null);
    expect((await sendRoute(req("/api/email-sender/send", json({ mode: "TEMPLATE", to: c.email, companyId: c.id, idempotencyKey: key() })), ctx)).status).toBe(401);
    for (const u of [t.admin, t.staff, t.clientA]) {
      as(u);
      expect((await sendRoute(req("/api/email-sender/send", json({ mode: "TEMPLATE", to: c.email, companyId: c.id, idempotencyKey: key() })), ctx)).status).toBe(403);
      expect((await sendRoute(req("/api/email-sender/send", json({ mode: "CUSTOM", to: c.email, companyId: c.id, subject: "Hi there", body: "Custom message body", idempotencyKey: key() })), ctx)).status).toBe(403);
      await expectRejects(service.sendEmail(u.actor, { mode: "TEMPLATE", to: c.email, companyId: c.id, idempotencyKey: key() }), 403);
    }
    expect(sent).toHaveLength(0);
    expect((await Company.findById(c.id).lean<CompanyDoc>())?.lead?.stage ?? "NEW").toBe("NEW");
    expect(await CrmActivity.countDocuments({ companyId: c.id })).toBe(0);
  });

  it("rejects missing or invalid recipients and unknown companies", async () => {
    const c = await company();
    for (const to of ["", "not-an-email", "a@b", "info@company .test"]) await expectRejects(service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to, companyId: c.id, idempotencyKey: key() }), 400);
    await expectRejects(service.sendEmail(t.owner.actor, { mode: "TEMPLATE", companyId: c.id, idempotencyKey: key() }), 400);
    await expectRejects(service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to: c.email, companyId: "not-an-id", idempotencyKey: key() }), 400);
    await expectRejects(service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to: c.email, companyId: "0123456789abcdef01234567", idempotencyKey: key() }), 404);
    expect(sent).toHaveLength(0);
  });

  it("never emails demo, marketing-protected or Do-not-contact companies", async () => {
    for (const extra of [{ isDemo: true }, { marketingProtected: true }, { lead: { stage: "DO_NOT_CONTACT" } }]) {
      const c = await company(extra);
      await expectRejects(service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to: c.email, companyId: c.id, idempotencyKey: key() }), 400);
    }
    expect(sent).toHaveLength(0);
  });

  it("a double click (same request key) sends once; the cooldown blocks a second deliberate send", async () => {
    const c = await company();
    const k = key();
    const [a, b] = await Promise.allSettled([
      service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to: c.email, companyId: c.id, idempotencyKey: k }),
      service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to: c.email, companyId: c.id, idempotencyKey: k }),
    ]);
    expect([a.status, b.status]).toContain("fulfilled");
    const again = await service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to: c.email, companyId: c.id, idempotencyKey: k });
    expect(again.duplicate).toBe(true);
    expect(sent).toHaveLength(1);
    expect(await CrmActivity.countDocuments({ companyId: c.id, type: "EMAIL" })).toBe(1);
    process.env.EMAIL_SENDER_COOLDOWN_MINUTES = "60";
    await expectRejects(service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to: c.email, companyId: c.id, idempotencyKey: key() }), 429);
    expect(sent).toHaveLength(1);
  });
});
