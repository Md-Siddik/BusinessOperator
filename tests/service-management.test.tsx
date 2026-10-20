import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/actor";
import type { Actor } from "@/lib/permissions";
import { expectRejects, makeTenants, makeUser } from "./helpers";

/**
 * Service Management: the public service catalogue, its pricing, discounts and landing pages.
 * Throw-away database; the services are the ExploreTechify services already on the website
 * (seeded from the existing content) plus clearly named test services.
 */
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://exploretechify.com";
});
const session = vi.hoisted(() => ({ current: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => session.current,
  getActor: async () => session.current?.actor ?? null,
}));

const { ContactRequest, Service, SystemSetting } = await import("@/models");
const catalog = await import("@/features/service-catalog/service");
const { runMigrations } = await import("@/lib/migrations");
const { submitContactRequest } = await import("@/features/content/service");
const { getBaseMessages } = await import("@/lib/i18n/dictionaries");
const { createTranslator } = await import("@/lib/i18n/translator");
const { ServiceLanding, servicePrice } = await import("@/components/site/service-landing");
const { setEmailProvider } = await import("@/lib/email/provider");
const { resetRateLimits } = await import("@/lib/rate-limit");
const emailService = await import("@/features/email-sender/service");
const servicesRoute = await import("@/app/api/services/route");
const serviceRoute = await import("@/app/api/services/[id]/route");
const pricingRoute = await import("@/app/api/services/[id]/pricing/route");
const publicRoute = await import("@/app/api/public/services/route");
const publicSlugRoute = await import("@/app/api/public/services/[slug]/route");

let t: Awaited<ReturnType<typeof makeTenants>>;
let staffWithPermission: Awaited<ReturnType<typeof makeUser>>;
const tr = (locale: string) => createTranslator(getBaseMessages(locale));
/** Intl uses non-breaking spaces in prices ("NOK 15 000"); compare with plain spaces. */
const sp = <T,>(v: T): T => JSON.parse(JSON.stringify(v).replace(/[\u00a0\u202f]/g, " "));
const req = (url: string, init?: { method?: string; body?: unknown }) => new NextRequest(new URL(url, "http://localhost:3000"), init ? { method: init.method ?? "POST", body: init.body === undefined ? undefined : JSON.stringify(init.body), headers: { "content-type": "application/json" } } : undefined);
const ctx = <P,>(params: P) => ({ params: Promise.resolve(params) });
function as(user: { actor: Actor } | null) {
  session.current = user ? { id: user.actor.id, name: user.actor.name, email: user.actor.email, role: user.actor.role, status: "ACTIVE", organizationId: user.actor.organizationId, organizationStatus: "ACTIVE", actor: user.actor } : null;
}
const sent: { subject: string; text: string }[] = [];
let n = 0;
const key = () => `svc-key-${Date.now()}-${++n}-abcdefgh`;

beforeAll(async () => {
  t = await makeTenants();
  staffWithPermission = await makeUser("STAFF", { permissions: ["chat.manage", "services.manage"] });
});
beforeEach(() => {
  as(null);
  resetRateLimits();
});

describe("Seeding from the existing website services", () => {
  it("shows the built-in services until the catalogue is seeded, then the database", async () => {
    expect(await Service.countDocuments()).toBe(0);
    expect((await catalog.listPublicServices("en")).map((s) => s.slug)).toContain("web-development");

    await runMigrations(() => undefined);
    const docs = await Service.find().lean<{ slug: string; pricing?: { amount?: number }; featured: boolean; active: boolean; translations: Record<string, { name?: string }> }[]>();
    expect(docs).toHaveLength(10);
    expect(docs.every((d) => d.active && d.pricing?.amount === undefined)).toBe(true); // no invented prices
    expect(docs.filter((d) => d.featured).map((d) => d.slug).sort()).toEqual(["automation", "digital-operations", "recruitment", "seo", "web-crm", "web-development"]);
    const web = await Service.findOne({ slug: "web-development" }).lean<{ translations: Map<string, { name?: string }> | Record<string, { name?: string }> }>();
    const tr0 = web!.translations instanceof Map ? web!.translations.get("no") : (web!.translations as Record<string, { name?: string }>).no;
    expect(tr0?.name).toBe("Nettsideutvikling");
    // English copies in other dictionaries are not stored as translations.
    expect(web!.translations instanceof Map ? web!.translations.has("de") : "de" in (web!.translations as object)).toBe(false);

    // Idempotent: never seeds twice, never overwrites the Owner's records.
    await Service.updateOne({ slug: "crm" }, { $set: { name: "CRM (edited)" } });
    await SystemSetting.updateOne({ key: "__migrations" }, { $pull: { "value.done": catalog.SEED_MIGRATION_ID } });
    await runMigrations(() => undefined);
    expect(await Service.countDocuments()).toBe(10);
    expect((await Service.findOne({ slug: "crm" }).lean<{ name: string }>())!.name).toBe("CRM (edited)");
  });

  it("serves the landing page in Norwegian from the database", async () => {
    const no = await catalog.getPublicService("web-development", "no");
    expect(no?.name).toBe("Nettsideutvikling");
    expect(no?.landing.heroTitle).toBe("Profesjonelle nettsider som gjør besøkende til kunder");
    expect((await catalog.getPublicService("web-development", "de"))?.name).toBe("Website Development"); // falls back to English
  });
});

describe("Owner manages services", () => {
  let id = "";

  it("adds a service as an inactive draft (not public) and publishes it", async () => {
    const created = await catalog.createService(t.owner.actor, {
      slug: "inventory-management",
      name: "Inventory Management",
      shortDescription: "Know what you have in stock, without spreadsheets.",
      icon: "Boxes",
      pricing: { model: "from", amount: 10000, currency: "NOK" },
      engagementOptions: ["project", "monthly"],
      landing: { heroTitle: "Stock control that keeps up with your business", included: ["Product register", "Stock levels and alerts"], steps: [{ title: "Map your products", text: "What you sell and where it is stored." }] },
      translations: { no: { name: "Lagerstyring", landing: { heroTitle: "Lagerstyring som holder tritt med bedriften" } } },
    });
    id = created.id;
    expect(await catalog.getPublicService("inventory-management", "en")).toBeNull();
    expect(await catalog.getPreviewService(t.owner.actor, "inventory-management", "en")).toMatchObject({ name: "Inventory Management", active: false });
    expect(await catalog.getPreviewService(t.clientA.actor, "inventory-management", "en")).toBeNull(); // the preview never leaks drafts

    await catalog.setServiceStatus(t.owner.actor, id, { active: true });
    const live = await catalog.getPublicService("inventory-management", "no");
    expect(live).toMatchObject({ name: "Lagerstyring", landing: { heroTitle: "Lagerstyring som holder tritt med bedriften", included: ["Product register", "Stock levels and alerts"] } });
    expect(servicePrice(live!, tr("no").t, "no").text).toMatch(/^Fra 10\s000\s?kr$/);
  });

  it("changes pricing and adds, changes and removes a discount", async () => {
    await catalog.updateServicePricing(t.owner.actor, id, { pricing: { model: "fixed", amount: 20000, currency: "NOK" } });
    await catalog.updateServiceDiscount(t.owner.actor, id, { discount: { enabled: true, type: "percent", value: 20, label: "Introductory offer" } });
    let v = (await catalog.getPublicService("inventory-management", "en"))!;
    let p = sp(servicePrice(v, tr("en").t, "en"));
    expect(p).toMatchObject({ text: "Fixed price: NOK 16,000", originalText: "Fixed price: NOK 20,000", discountLabel: "Introductory offer · 20% off" });

    await catalog.updateServiceDiscount(t.owner.actor, id, { discount: { enabled: true, type: "fixed", value: 2500, endsAt: new Date(Date.now() + 86_400_000).toISOString() } });
    v = (await catalog.getPublicService("inventory-management", "en"))!;
    p = sp(servicePrice(v, tr("en").t, "en"));
    expect(p.text).toBe("Fixed price: NOK 17,500");
    expect(p.validUntil).toBeTruthy();

    // A discount that has not started yet is not shown.
    await catalog.updateServiceDiscount(t.owner.actor, id, { discount: { enabled: true, type: "percent", value: 10, startsAt: new Date(Date.now() + 5 * 86_400_000).toISOString() } });
    expect(sp(servicePrice((await catalog.getPublicService("inventory-management", "en"))!, tr("en").t, "en").text)).toBe("Fixed price: NOK 20,000");

    await catalog.updateServiceDiscount(t.owner.actor, id, { discount: null });
    expect((await catalog.getPublicService("inventory-management", "en"))!.discount).toBeNull();

    // Guards: a fixed discount below the price, percentages ≤ 90, no discount without a price.
    await expectRejects(catalog.updateServiceDiscount(t.owner.actor, id, { discount: { enabled: true, type: "fixed", value: 20000 } }), 400);
    await expectRejects(catalog.updateServiceDiscount(t.owner.actor, id, { discount: { enabled: true, type: "percent", value: 95 } }), 400);
    await catalog.updateServicePricing(t.owner.actor, id, { pricing: { model: "quote", currency: "NOK" } });
    await expectRejects(catalog.updateServiceDiscount(t.owner.actor, id, { discount: { enabled: true, type: "percent", value: 10 } }), 400);
    expect(servicePrice((await catalog.getPublicService("inventory-management", "en"))!, tr("en").t, "en").text).toBe("Quoted per project after a short conversation");
  });

  it("features services on the homepage and changes the display order", async () => {
    await catalog.updateService(t.owner.actor, id, { featured: true });
    const all = await catalog.listPublicServices("en");
    expect(all.filter((s) => s.featured).map((s) => s.slug)).toContain("inventory-management");

    const { rows } = await catalog.listServicesAdmin(t.owner.actor);
    const ids = rows.map((r) => r.id);
    await catalog.reorderServices(t.owner.actor, { ids: [id, ...ids.filter((x) => x !== id)] });
    expect((await catalog.listPublicServices("en"))[0]!.slug).toBe("inventory-management");
  });

  it("deactivating hides the service and its page, and removes it from the homepage", async () => {
    await catalog.setServiceStatus(t.owner.actor, id, { active: false });
    expect(await catalog.getPublicService("inventory-management", "en")).toBeNull();
    expect((await Service.findById(id).lean<{ featured: boolean }>())!.featured).toBe(false);
    const { summary } = await catalog.listServicesAdmin(t.owner.actor);
    expect(summary).toMatchObject({ total: 11, inactive: 1 });
  });

  it("deletes safely: trash and restore; permanent deletion only by the Owner, with confirmation, and never with history", async () => {
    await catalog.trashService(t.owner.actor, id);
    expect((await catalog.listServicesAdmin(t.owner.actor, { trash: true })).rows.map((r) => r.slug)).toEqual(["inventory-management"]);
    await catalog.restoreService(t.owner.actor, id);
    expect(await Service.findById(id).lean<{ deletedAt?: Date; active: boolean }>()).toMatchObject({ active: false });

    // A visitor enquired from this landing page → the history must stay intact.
    await submitContactRequest({ name: "Kari Test", email: "kari@company.example", message: "We would like to know more about stock control.", service: "inventory-management", locale: "en" });
    expect(await ContactRequest.countDocuments({ serviceSlug: "inventory-management" })).toBe(1);

    await expectRejects(catalog.deleteServicePermanently(t.admin.actor, id, { confirmSlug: "inventory-management" }), 403);
    await expectRejects(catalog.deleteServicePermanently(t.owner.actor, id, { confirmSlug: "wrong" }), 400);
    await expectRejects(catalog.deleteServicePermanently(t.owner.actor, id, { confirmSlug: "inventory-management" }), 409);
    expect(await Service.exists({ _id: id })).toBeTruthy();

    await ContactRequest.deleteMany({ serviceSlug: "inventory-management" });
    expect(await catalog.deleteServicePermanently(t.owner.actor, id, { confirmSlug: "inventory-management" })).toMatchObject({ deleted: true });
    expect(await Service.exists({ _id: id })).toBeNull();
  });
});

describe("Validation and safety", () => {
  it("rejects bad slugs, duplicate slugs, unsafe CTA links and unknown languages", async () => {
    const base = { name: "Test Service" };
    await expectRejects(catalog.createService(t.owner.actor, { ...base, slug: "Bad Slug!" }), 400);
    await expectRejects(catalog.createService(t.owner.actor, { ...base, slug: "web-development" }), 409);
    for (const href of ["javascript:alert(1)", "//evil.example", "http://insecure.example", "data:text/html,x"]) await expectRejects(catalog.createService(t.owner.actor, { ...base, slug: `cta-test-${n++}`, cta: { href } }), 400);
    await expectRejects(catalog.createService(t.owner.actor, { ...base, slug: "lang-test", translations: { xx: { name: "X" } } }), 400);
    await expectRejects(catalog.createService(t.owner.actor, { ...base, slug: "lang-test-en", translations: { en: { name: "X" } } }), 400);
  });

  it("stores text as plain text and renders it escaped", async () => {
    const { id } = await catalog.createService(t.owner.actor, { slug: "escape-test", name: 'Safe <script>alert("x")</script> Name', active: true, landing: { solution: "<img src=x onerror=alert(1)>" } });
    const v = (await catalog.getPublicService("escape-test", "en"))!;
    const html = renderToStaticMarkup(<ServiceLanding service={v} related={[]} locale="en" t={tr("en").t} cases={[]} />);
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    await catalog.trashService(t.owner.actor, id);
  });
});

describe("Permissions (server-side)", () => {
  it("Owner, Admin (default) and permitted staff manage services; others are refused", async () => {
    expect((await catalog.listServicesAdmin(t.admin.actor)).rows.length).toBeGreaterThan(0); // ADMIN holds services.manage by default
    expect((await catalog.listServicesAdmin(staffWithPermission.actor)).rows.length).toBeGreaterThan(0);
    for (const who of [t.staff.actor, t.clientA.actor]) {
      await expectRejects(catalog.listServicesAdmin(who), 403);
      await expectRejects(catalog.createService(who, { slug: "nope", name: "Nope service" }), 403);
    }
    await expectRejects(catalog.listServicesAdmin(null), 401);
  });

  it("the API routes enforce the same rules; public routes expose active services and public fields only", async () => {
    expect((await servicesRoute.POST(req("/api/services", { body: { slug: "api-test", name: "API test" } }), ctx({}))).status).toBe(401);
    as(t.staff);
    expect((await servicesRoute.POST(req("/api/services", { body: { slug: "api-test", name: "API test" } }), ctx({}))).status).toBe(403);
    as(t.clientA);
    expect((await servicesRoute.GET(req("/api/services"), ctx({}))).status).toBe(403);

    as(t.admin);
    const created = await servicesRoute.POST(req("/api/services", { body: { slug: "api-test", name: "API test", active: true, pricing: { model: "fixed", amount: 5000, currency: "EUR" } } }), ctx({}));
    expect(created.status).toBe(200);
    const { id } = (await created.json()) as { id: string };
    as(t.staff);
    expect((await pricingRoute.PATCH(req(`/api/services/${id}/pricing`, { method: "PATCH", body: { pricing: { model: "fixed", amount: 1 } } }), ctx({ id }))).status).toBe(403);
    expect((await serviceRoute.DELETE(req(`/api/services/${id}`, { method: "DELETE" }), ctx({ id }))).status).toBe(403);
    as(t.admin);
    // Admins cannot delete permanently — only the Owner.
    const perm = await serviceRoute.DELETE(req(`/api/services/${id}?permanent=1`, { method: "DELETE", body: { confirmSlug: "api-test" } }), ctx({ id }));
    expect(perm.status).toBe(403);

    as(null);
    const pub = await publicRoute.GET(req("/api/public/services?locale=en"), ctx({}));
    expect(pub.status).toBe(200);
    const list = (await pub.json()) as Record<string, unknown>[];
    const item = list.find((s) => s.slug === "api-test")!;
    expect(item).toBeTruthy();
    for (const hidden of ["id", "_id", "createdBy", "updatedBy", "deletedAt", "translations"]) expect(item).not.toHaveProperty(hidden);
    expect(list.every((s) => s.active === true)).toBe(true);
    expect((await publicSlugRoute.GET(req("/api/public/services/escape-test"), ctx({ slug: "escape-test" }))).status).toBe(404); // in the trash
    expect((await publicSlugRoute.GET(req("/api/public/services/api-test"), ctx({ slug: "api-test" }))).status).toBe(200);
  });
});

describe("Outreach emails use the live service", () => {
  beforeEach(() => {
    sent.length = 0;
    setEmailProvider({ id: "test-provider", isLive: true, async send(email) { sent.push(email); return { id: `m-${sent.length}` }; } });
    process.env.EMAIL_SENDER_COOLDOWN_MINUTES = "0";
  });

  it("includes the current price, discount and landing page; falls back to the homepage when the service is off", async () => {
    const web = (await Service.findOne({ slug: "web-development" }).lean<{ _id: unknown }>())!;
    const wid = String(web._id);
    await catalog.updateService(t.owner.actor, wid, { active: true, pricing: { model: "fixed", amount: 15000, currency: "NOK" }, discount: { enabled: true, type: "percent", value: 10, label: "Introduksjonstilbud" } });
    await emailService.sendEmail(t.owner.actor, { mode: "TEMPLATE", templateId: "no-website", locale: "no", to: "lead@company.example", idempotencyKey: key() });
    expect(sent[0]!.text).toMatch(/Fastpris: 13\s500\s?kr \(Introduksjonstilbud · 10% rabatt\)/);
    expect(sent[0]!.text).toContain("https://exploretechify.com/no/services/web-development");

    await catalog.setServiceStatus(t.owner.actor, wid, { active: false });
    await emailService.sendEmail(t.owner.actor, { mode: "TEMPLATE", templateId: "no-website", locale: "en", to: "lead2@company.example", idempotencyKey: key() });
    expect(sent[1]!.text).toContain("A fixed price, agreed in writing before we start");
    expect(sent[1]!.text).not.toContain("/services/web-development");
    await catalog.setServiceStatus(t.owner.actor, wid, { active: true });
  });

  it("creating or editing a service never sends email", async () => {
    await catalog.createService(t.owner.actor, { slug: "quiet-service", name: "Quiet service", active: true });
    expect(sent).toHaveLength(0);
  });
});
