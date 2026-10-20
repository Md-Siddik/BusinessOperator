import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Company, CrmActivity, EmailMessage, type EmailMessageDoc } from "@/models";
import type { SessionUser } from "@/lib/auth/actor";
import type { Actor } from "@/lib/permissions";
import { expectRejects, makeTenants } from "./helpers";

/**
 * Situation-based outreach templates (English + Norwegian), personalisation from Company
 * Intelligence and the single polite reminder. A mocked provider records sends — no real
 * email is sent. Companies are fictional fixtures in a throw-away database.
 */
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://exploretechify.com";
});
const session = vi.hoisted(() => ({ current: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => session.current,
  getActor: async () => session.current?.actor ?? null,
}));

const { setEmailProvider } = await import("@/lib/email/provider");
const service = await import("@/features/email-sender/service");
const { resetRateLimits } = await import("@/lib/rate-limit");
const { renderEmail } = await import("@/features/email-sender/template");
const { buildOutreachEmail, OUTREACH_TEMPLATE_IDS, outreachContext, suggestOutreach } = await import("@/features/email-sender/outreach");
const { POST: templateRoute } = await import("@/app/api/email-sender/template/route");

type Sent = { to: string; subject: string; text: string; html?: string };
const sent: Sent[] = [];
let t: Awaited<ReturnType<typeof makeTenants>>;
let n = 0;
const key = () => `outreach-key-${Date.now()}-${++n}-abcdefgh`;
const sig = { name: "ExploreTechify Team", email: "hello@exploretechify.com" };
const req = (url: string, body: unknown) => new NextRequest(new URL(url, "http://localhost:3000"), { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const ctx = { params: Promise.resolve({}) };
function as(user: { actor: Actor } | null) {
  session.current = user ? { id: user.actor.id, name: user.actor.name, email: user.actor.email, role: user.actor.role, status: "ACTIVE", organizationId: user.actor.organizationId, organizationStatus: "ACTIVE", actor: user.actor } : null;
}
let seq = 0;
async function company(fields: Record<string, unknown> = {}) {
  seq++;
  return Company.create({ companyName: `Fjordlys Rørlegger ${seq} AS`, countryCode: "NO", source: "fixture", sourceId: `o-${seq}`, registrationNumber: `81${String(seq).padStart(7, "0")}`, registrationDay: new Date().toISOString().slice(0, 10), city: "Bergen", eventType: "NEW_ENTITY", email: `post${seq}@fjordlys.example`, ...fields });
}

beforeAll(async () => {
  t = await makeTenants();
});
beforeEach(() => {
  sent.length = 0;
  resetRateLimits();
  setEmailProvider({ id: "test-provider", isLive: true, async send(email) { sent.push(email); return { id: `m-${sent.length}` }; } });
  process.env.EMAIL_SENDER_COOLDOWN_MINUTES = "0";
  process.env.EMAIL_SENDER_HOURLY_LIMIT = "1000";
  process.env.EMAIL_SENDER_DAILY_LIMIT = "1000";
});

describe("Choosing a relevant first email", () => {
  it("hiring → recruitment, no website → website offer, website → visibility; Norwegian for Norwegian companies", () => {
    expect(suggestOutreach({ countryCode: "NO", website: "https://a.example", signals: { hiring: true } })).toMatchObject({ templateId: "recruitment", locale: "no" });
    expect(suggestOutreach({ countryCode: "NO" })).toMatchObject({ templateId: "no-website", locale: "no" });
    expect(suggestOutreach({ countryCode: "SE", website: "https://b.example" })).toMatchObject({ templateId: "has-website", locale: "en" });
  });

  it("states 'no website found' only when website research actually ran", () => {
    const researched = buildOutreachEmail("no-website", "en", outreachContext({ companyName: "Nordlys AS", research: { attempts: 2 } }));
    expect(researched.body).toContain("could not find a dedicated website");
    const unknown = buildOutreachEmail("no-website", "en", outreachContext({ companyName: "Nordlys AS", registrationDay: "2001-01-01" }));
    expect(unknown.body).not.toMatch(/could not find|no website/i);
    const fresh = buildOutreachEmail("no-website", "no", outreachContext({ companyName: "Nordlys AS", city: "Tromsø", registrationDay: new Date().toISOString().slice(0, 10) }));
    expect(fresh.body).toContain("Vi så at Nordlys AS nylig er registrert i Tromsø");
  });

  it("is short, calm and concrete in both languages — no urgency, guarantees or invented prices", () => {
    for (const id of OUTREACH_TEMPLATE_IDS) {
      for (const locale of ["en", "no"] as const) {
        const e = buildOutreachEmail(id, locale, { companyName: "Nordlys AS" });
        const all = `${e.subject} ${e.body}`;
        expect(all).not.toMatch(/!|buy now|limited time|act now|hurry|last chance|garanti|guarantee|\b10x\b|kr \d|NOK \d/i);
        // Short: the existing English introduction is the longest; the situation emails stay tighter.
        expect(e.body.split(/\s+/).length).toBeLessThan(id === "general" ? 220 : 160);
        if (id !== "general") expect(e.body).not.toMatch(/SEO and digital visibility, social media, automation, CRM/); // no catalogue dump
      }
    }
    expect(buildOutreachEmail("no-website", "en").body).toContain("A fixed price, agreed in writing before we start");
    expect(buildOutreachEmail("no-website", "no").body).toContain("Fast pris, avtalt skriftlig før vi starter");
  });

  it("personalises safely: markup in company data is neutralised, the button only links to our own site", () => {
    const offer = { name: "Website Development", priceText: "From NOK 10,000", url: "https://exploretechify.com/services/web-development" };
    const e = buildOutreachEmail("no-website", "en", { companyName: "**Bold** ## Corp", contactName: "Kari Nordmann", websiteResearched: true, offer });
    expect(e.body.startsWith("Hello Kari Nordmann,")).toBe(true);
    expect(e.body).toContain("We looked for Bold Corp online");
    expect(e.body).toContain("Price and delivery**: From NOK 10,000.");
    expect(e.cta?.url).toBe("https://exploretechify.com/services/web-development");
    // Without a live service the button goes to the homepage, never to a missing page.
    expect(buildOutreachEmail("no-website", "en").cta?.url).toBe("https://exploretechify.com/");
    const r = renderEmail({ ...e, cta: { label: "Click", url: "https://evil.example/" } }, { unsubscribeUrl: "https://exploretechify.com/unsubscribe", signature: sig });
    expect(r.html).not.toContain("evil.example");
    expect(r.html).toContain('href="https://exploretechify.com/"');
  });

  it("renders a Norwegian layout: greeting, signature, opt-out, tagline and language", () => {
    const e = buildOutreachEmail("no-website", "no", { companyName: "Nordlys AS", offer: { name: "Nettsideutvikling", priceText: "Fastpris, avtalt skriftlig før vi starter", url: "https://exploretechify.com/no/services/web-development" } });
    const r = renderEmail(e, { unsubscribeUrl: "https://exploretechify.com/unsubscribe", signature: sig });
    for (const s of ['lang="nb"', "Hei,", "Med vennlig hilsen", "melde deg av her", "Nettsider som gjør besøkende til kunder.", "https://exploretechify.com/no/services/web-development", "kan vi bygge en avtalt første versjon", "hello@exploretechify.com"]) expect(r.html).toContain(s);
    expect(r.html).not.toContain("Best regards");
    expect(r.html).not.toContain("/work"); // no portfolio link while no client projects are published
    expect(r.text).toContain("Med vennlig hilsen");
  });
});

describe("Sending from Company Intelligence", () => {
  it("auto-selects and personalises the template from the company record (server-side)", async () => {
    const c = await company({ research: { status: "NO_CONTACT_YET", attempts: 1 }, contactPerson: { name: "Ola Nordmann", role: "Daglig leder" } });
    const r = await service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to: c.email, companyId: String(c._id), idempotencyKey: key() });
    expect(r.status).toBe("SENT");
    expect(sent[0]!.subject).toBe(`En profesjonell nettside for ${c.companyName}`);
    expect(sent[0]!.text).toContain("Hei Ola Nordmann,");
    expect(sent[0]!.text).toContain(`Vi så etter ${c.companyName} på nett og fant ingen egen nettside.`);
    const rec = await EmailMessage.findOne({ _id: r.id }).lean<EmailMessageDoc>();
    expect(rec).toMatchObject({ outreachTemplate: "no-website-v1-no", outreachStep: "INITIAL", locale: "no", body: "[template no-website-v1-no]" });
    expect((await CrmActivity.findOne({ companyId: c._id }).lean<{ body: string }>())!.body).toContain("no website — website offer template");
  });

  it("honours the Owner's template and language choice and previews exactly what is sent", async () => {
    const c = await company({ website: "https://fjordlys.example", auditSummary: { https: false } });
    const preview = await service.previewEmail(t.owner.actor, { mode: "TEMPLATE", companyId: String(c._id), templateId: "has-website", locale: "en" }, c.email!);
    await service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to: c.email, companyId: String(c._id), templateId: "has-website", locale: "en", idempotencyKey: key() });
    expect(sent[0]!.subject).toBe(preview.subject);
    expect(sent[0]!.text).toContain("noticed that the site does not appear to use a secure connection (HTTPS)");
  });
});

describe("One polite reminder, then stop", () => {
  it("needs a company and an earlier email, waits at least 7 days, and is sent at most once", async () => {
    await expectRejects(service.sendEmail(t.owner.actor, { mode: "TEMPLATE", templateId: "reminder", to: "x@fjordlys.example", idempotencyKey: key() }), 400);

    const c = await company();
    const id = String(c._id);
    const remind = () => service.sendEmail(t.owner.actor, { mode: "TEMPLATE", templateId: "reminder", to: c.email, companyId: id, idempotencyKey: key() });
    await expectRejects(remind(), 400); // no first email yet

    await service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to: c.email, companyId: id, idempotencyKey: key() });
    await expectRejects(remind(), 400); // too early
    expect((await service.getCompanyTemplate(t.owner.actor, { companyId: id, templateId: "reminder" })).reminder).toMatchObject({ allowed: false });

    await EmailMessage.updateMany({ companyId: c._id }, { $set: { sentAt: new Date(Date.now() - 8 * 86_400_000), createdAt: new Date(Date.now() - 8 * 86_400_000) } });
    expect((await service.getCompanyTemplate(t.owner.actor, { companyId: id, templateId: "reminder" })).reminder.allowed).toBe(true);
    const r = await remind();
    expect(r.status).toBe("SENT");
    expect(sent.at(-1)!.text).toContain("da tar vi ikke kontakt igjen");
    expect((await EmailMessage.findOne({ _id: r.id }).lean<EmailMessageDoc>())!.outreachStep).toBe("REMINDER");

    await expectRejects(remind(), 400); // never a second reminder
    expect(await EmailMessage.countDocuments({ companyId: c._id, outreachStep: "REMINDER" })).toBe(1);
  });

  it("never reminds a company that already replied", async () => {
    const c = await company();
    await service.sendEmail(t.owner.actor, { mode: "TEMPLATE", to: c.email, companyId: String(c._id), idempotencyKey: key() });
    await EmailMessage.updateMany({ companyId: c._id }, { $set: { sentAt: new Date(Date.now() - 10 * 86_400_000) } });
    await Company.updateOne({ _id: c._id }, { $set: { "lead.stage": "REPLIED" } });
    await expectRejects(service.sendEmail(t.owner.actor, { mode: "TEMPLATE", templateId: "reminder", to: c.email, companyId: String(c._id), idempotencyKey: key() }), 400);
  });
});

describe("Owner-only", () => {
  it("company templates and the template route refuse admins, staff and clients", async () => {
    const c = await company();
    for (const u of [t.admin, t.staff, t.clientA]) {
      await expectRejects(service.getCompanyTemplate(u.actor, { companyId: String(c._id) }), 403);
      await expectRejects(Promise.resolve().then(() => service.listTemplates(u.actor)), 403);
      as(u);
      expect((await templateRoute(req("/api/email-sender/template", { companyId: String(c._id) }), ctx)).status).toBe(403);
    }
    as(null);
    expect((await templateRoute(req("/api/email-sender/template", { companyId: String(c._id) }), ctx)).status).toBe(401);
    as(t.owner);
    const ok = await templateRoute(req("/api/email-sender/template", { companyId: String(c._id) }), ctx);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ templateId: "no-website", locale: "no", suggestion: { templateId: "no-website" } });
    expect(sent).toHaveLength(0);
  });
});
