import { beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SERVICE_PAGES } from "@/config/service-pages";
import { SERVICE_CATEGORIES } from "@/config/services";
import { getBaseMessages } from "@/lib/i18n/dictionaries";
import { createTranslator } from "@/lib/i18n/translator";
import { videoEmbed } from "@/lib/media";
import { listCaseStudiesForServices, listPublishedCaseStudies, saveCaseStudy } from "@/features/content/service";
import { defaultServiceViews, type ServiceView } from "@/features/service-catalog/view";
import { CaseStudy } from "@/models";
import { deliveryText, ServiceCardsGrid, ServiceLanding, servicePrice } from "@/components/site/service-landing";
import { VideoShowcase } from "@/components/site/portfolio";
import { EngagementModels } from "@/components/site/engagement-models";
import { DigitalSideSection } from "@/components/site/digital-side";
import { InfrastructureSection } from "@/components/site/infrastructure";
import { BuildFirstModel } from "@/components/site/build-first";
import { LANGUAGE_CODES } from "@/config/languages";
import { expectRejects, makeTenants } from "./helpers";

/**
 * Public service landing pages (rendered from the built-in defaults here — the same views the
 * site shows without a database; Service Management data is covered in service-management.test.ts),
 * portfolio and engagement models. Case studies are fixtures in a throw-away database.
 */
const tr = (locale: string) => createTranslator(getBaseMessages(locale));
const views = (locale: string) => defaultServiceViews(locale, tr(locale).raw);
const view = (slug: string, locale = "en") => views(locale).find((s) => s.slug === slug)!;
const render = (service: ServiceView, locale: string, cases = [] as Awaited<ReturnType<typeof listPublishedCaseStudies>>, related: ServiceView[] = []) =>
  renderToStaticMarkup(<ServiceLanding service={service} related={related} locale={locale} t={tr(locale).t} cases={cases} />);

let t: Awaited<ReturnType<typeof makeTenants>>;
beforeAll(async () => {
  t = await makeTenants();
});

describe("Service landing pages", () => {
  it("has a focused page for every original service, with SEO-friendly unique slugs", () => {
    const slugs = views("en").map((p) => p.slug);
    expect(slugs).toEqual(expect.arrayContaining(["web-development", "crm", "web-crm", "visual-identity", "data-collection", "seo", "social-media", "recruitment", "automation", "digital-operations"]));
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const p of SERVICE_PAGES) for (const r of p.related) expect(slugs, `${p.slug} → ${r}`).toContain(r);
    expect(SERVICE_CATEGORIES.map((c) => c.slug)).toContain("digital-foundation"); // original area pages keep their URLs
  });

  it("has complete English and Norwegian content for every page", () => {
    for (const locale of ["en", "no"]) {
      for (const v of views(locale)) {
        for (const k of ["name", "shortDescription"] as const) expect(v[k].trim().length, `${locale} ${v.slug}.${k}`).toBeGreaterThanOrEqual(2);
        for (const k of ["heroTitle", "heroSubtitle", "solution"] as const) expect((v.landing[k] ?? "").length, `${locale} ${v.slug}.landing.${k}`).toBeGreaterThan(3);
        for (const k of ["problem", "included", "steps", "deliverables", "notIncluded", "optional", "faq"] as const) expect(v.landing[k].length, `${locale} ${v.slug}.${k}`).toBeGreaterThan(0);
        expect((v.seo.description ?? "").length).toBeLessThanOrEqual(170);
      }
    }
    expect(view("web-development", "no").landing.heroTitle).toBe("Profesjonelle nettsider som gjør besøkende til kunder");
  });

  it("stays calm and honest: no urgency, no promised rankings or results", () => {
    for (const locale of ["en", "no"]) {
      // "Not included: guaranteed rankings" and FAQ disclaimers are honest; promises anywhere else are not.
      const promises = JSON.stringify(views(locale).map((v) => ({ ...v, landing: { ...v.landing, notIncluded: [], faq: [] } })));
      expect(promises).not.toMatch(/!|buy now|limited time|act now|hurry|last chance|#1|10x/i);
      expect(promises).not.toMatch(/\bwe guarantee\b|\bvi garanterer\b|(?<!no )guaranteed (rankings?|results?|traffic|sales)\b|(?<!løfter om )garantert (rangering|resultat|trafikk|salg)/i);
    }
    expect(view("seo").landing.faq[0]!.a).toContain("Anyone who guarantees rankings is promising something they do not control");
  });

  it("never invents a price: without an approved amount it says how the price is agreed", () => {
    const { t: en } = tr("en");
    const v = view("web-development");
    expect(v.pricing.amount ?? null).toBeNull();
    expect(servicePrice(v, en, "en").text).toBe("Fixed price, agreed in writing before we start");
    expect(deliveryText(v, en)).toBe("Timeline agreed in the offer before work starts");
    const priced: ServiceView = { ...v, pricing: { model: "fixed", amount: 15000, currency: "NOK" }, landing: { ...v.landing, delivery: "2–4 weeks" } };
    expect(servicePrice(priced, tr("no").t, "no").text).toMatch(/^Fastpris: 15\s000\s?kr$/);
    expect(servicePrice(priced, en, "en").text.replace(/\s/g, " ")).toBe("Fixed price: NOK 15,000");
    expect(deliveryText(priced, en)).toBe("2–4 weeks");
  });

  it("renders the full landing page in Norwegian with working CTAs, Home navigation and no fake proof", () => {
    const html = render(view("web-development", "no"), "no", [], [view("seo", "no")]);
    for (const s of ["Profesjonelle nettsider som gjør besøkende til kunder", "Be om tilbud", "Dette er inkludert", "Slik foregår det", "Pris og levering", "Ikke inkludert", "Slik kan vi samarbeide", "Spørsmål og svar", "Hva skjer videre", "Relaterte tjenester", "Tilbake til hovedsiden", "Slik fungerer «bygg først»"]) expect(html).toContain(s);
    // No published examples yet: no empty portfolio section, and the hero points to price and delivery instead.
    expect(html).not.toContain('id="examples"');
    expect(html).toContain('href="#pricing"');
    expect(html).toContain('href="/no/how-we-work/build-first"');
    expect(html).toContain('href="/no/contact?need=website&amp;service=web-development"');
    expect(html).toContain('href="/no"'); // Home
    expect(html).toContain('href="/no/services/seo"');
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).not.toMatch(/testimonial|★/i);
  });

  it("presents the growth partnership separately from the service price", () => {
    const html = render(view("digital-operations"), "en");
    expect(html).toContain("How you can work with us");
    expect(html).toContain("This is the price of the service itself. How we work together is agreed separately.");
    expect(html).toContain("Selective and by discussion — a separate strategic relationship with individually agreed terms, not a payment plan.");
    expect(html).toContain('href="/how-we-work/growth-partnership"');
  });

  it("links every service card to its landing page; wide services become the partner band", () => {
    const html = renderToStaticMarkup(<ServiceCardsGrid services={views("en")} locale="en" t={tr("en").t} />);
    for (const p of SERVICE_PAGES) expect(html).toContain(`href="/services/${p.slug}"`);
    expect(html).toContain("You run the physical business. We help run the digital side.");
    expect(renderToStaticMarkup(<ServiceCardsGrid services={[]} locale="en" t={tr("en").t} />)).toBe("");
  });
});

describe("Digital side section", () => {
  it("keeps the exact headline as an operating model — your side and our side — with no buttons (not a second hero)", () => {
    const { t: en, list } = tr("en");
    const html = renderToStaticMarkup(<DigitalSideSection t={en} list={list} />);
    expect(html).toContain("You run the business.</span> <span");
    expect(html).toContain("We run the digital side.");
    expect(html).toContain("You stay in charge of your business and its decisions.");
    for (const s of ["Your side", "Your business", "Our side", "The digital side", "Products &amp; services", "Website and online presence", "One point of contact"]) expect(html).toContain(s);
    expect(html).not.toMatch(/<a |<button/);
    expect(html.match(/<h2/g)).toHaveLength(1);
    // A model of who does what: no promises, numbers or invented activity in the visible text.
    expect(html.replace(/<[^>]+>|&[#\w]+;/g, " ")).not.toMatch(/guarantee|10x|%|\d/i);
    for (const code of LANGUAGE_CODES) {
      const { t, list: l } = tr(code);
      expect(renderToStaticMarkup(<DigitalSideSection t={t} list={l} />), code).toContain(t("home.digitalSide.titleDigital"));
    }
  });
});

describe("Digital business infrastructure", () => {
  it("presents one outcome in four layers, and only the Owner's featured services as starting points", () => {
    const { t: en, list } = tr("en");
    const all = views("en");
    const featured = all.slice(0, 2);
    const html = renderToStaticMarkup(<InfrastructureSection locale="en" t={en} list={list} featured={featured} />);
    expect(html).toContain("Your digital business infrastructure");
    for (const layer of ["Presence", "Enquiries", "Systems", "Care"]) expect(html).toContain(layer);
    for (const s of featured) expect(html).toContain(`href="/services/${s.slug}"`);
    for (const s of all.slice(2)) expect(html).not.toContain(`href="/services/${s.slug}"`);
    expect(html).toContain('href="/services"');
    expect(renderToStaticMarkup(<InfrastructureSection locale="en" t={en} list={list} featured={[]} />)).not.toContain("Common starting points");
  });
});

describe("Build-first working model", () => {
  it("shows the low-risk model with its terms, without a portfolio", () => {
    const { t: en, list } = tr("en");
    const html = renderToStaticMarkup(<BuildFirstModel locale="en" t={en} list={list} />);
    expect(html).toContain("We would rather show you what we propose than ask you to buy an idea you haven&#x27;t seen.");
    expect(html).toContain("Not free development");
    expect(html).toContain("Prefer a classic arrangement?");
    expect(html).toContain('href="/how-we-work/build-first"');
    expect(html).not.toMatch(/See what we build|Our work/i);
  });
});

describe("Site appearance", () => {
  it("defaults to mixed and only accepts the three known modes from storage", async () => {
    const { SITE_THEMES, DEFAULT_SITE_THEME, SITE_THEME_SCRIPT } = await import("@/components/site/theme");
    expect(SITE_THEMES).toEqual(["dark", "light", "mixed"]);
    expect(DEFAULT_SITE_THEME).toBe("mixed");
    const run = (stored: string | null) => {
      const attrs: Record<string, string> = { "data-site-theme": DEFAULT_SITE_THEME };
      const doc = { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } };
      new Function("localStorage", "document", SITE_THEME_SCRIPT)({ getItem: () => stored }, doc);
      return attrs["data-site-theme"];
    };
    expect(run(null)).toBe("mixed");
    expect(run("dark")).toBe("dark");
    expect(run("light")).toBe("light");
    expect(run("mixed")).toBe("mixed");
    expect(run("<script>")).toBe("mixed");
    for (const code of LANGUAGE_CODES) for (const k of ["label", "dark", "light", "mixed"]) expect(tr(code).t(`theme.${k}`), `${code} theme.${k}`).not.toBe(`theme.${k}`);
  });
});

describe("Engagement models stay", () => {
  it("shows monthly, task-based and the separate growth partnership on the homepage", () => {
    const { t: en, list } = tr("en");
    const html = renderToStaticMarkup(<EngagementModels locale="en" t={en} list={list} />);
    for (const slug of ["monthly", "growth-partnership", "task-based"]) expect(html).toContain(`href="/how-we-work/${slug}"`);
    expect(html).toContain('id="engagement"');
  });
});

describe("Portfolio and video showcase", () => {
  it("accepts only safe video sources", () => {
    expect(videoEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({ kind: "iframe", src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0" });
    expect(videoEmbed("https://youtu.be/dQw4w9WgXcQ")?.kind).toBe("iframe");
    expect(videoEmbed("https://vimeo.com/123456789")).toEqual({ kind: "iframe", src: "https://player.vimeo.com/video/123456789?dnt=1" });
    expect(videoEmbed("https://cdn.example.com/walkthrough.mp4")).toMatchObject({ kind: "file", type: "video/mp4" });
    for (const bad of ["http://www.youtube.com/watch?v=dQw4w9WgXcQ", "javascript:alert(1)", "https://evil.example/embed/x", "https://www.youtube.com/watch?v=<script>"]) expect(videoEmbed(bad)).toBeNull();
  });

  it("shows a clearly marked placeholder until real videos are published", () => {
    const html = renderToStaticMarkup(<VideoShowcase cases={[]} t={tr("en").t} />);
    expect(html).toContain("Coming soon");
    expect(html).toContain("Video walkthroughs are being prepared");
    expect(html).not.toContain("<iframe");
  });

  it("stores project, thumbnail and video links, shows them on the right landing page, and can clear them", async () => {
    const base = { slug: "fixture-website", clientName: "Fixture Bakery (example)", services: ["businessWebsite"], technologies: [], isExample: true, published: true, content: { title: "Bakery website" } };
    const saved = await saveCaseStudy(t.owner.actor, null, { ...base, projectUrl: "https://bakery.example", thumbnailUrl: "https://bakery.example/cover.png", videoUrl: "https://youtu.be/dQw4w9WgXcQ" });
    await expectRejects(saveCaseStudy(t.owner.actor, null, { ...base, slug: "fixture-bad", videoUrl: "https://evil.example/video" }), 400);
    await expectRejects(saveCaseStudy(t.owner.actor, null, { ...base, slug: "fixture-bad2", projectUrl: "http://insecure.example" }), 400);

    const cases = await listCaseStudiesForServices(view("web-development").portfolioServices, "en");
    expect(cases.map((c) => c.slug)).toEqual(["fixture-website"]);
    expect(await listCaseStudiesForServices(view("recruitment").portfolioServices, "en")).toEqual([]);

    const html = render(view("web-development"), "en", cases);
    expect(html).toContain('id="examples"'); // shown once real examples exist
    expect(html).toContain("Bakery website");
    expect(html).toContain("Example"); // illustrative work is always labelled
    expect(html).toContain('href="https://bakery.example"');
    expect(renderToStaticMarkup(<VideoShowcase cases={cases} t={tr("en").t} />)).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0"');

    await saveCaseStudy(t.owner.actor, String(saved._id), { ...base, projectUrl: "", thumbnailUrl: "", videoUrl: "" });
    const cleared = await CaseStudy.findById(saved._id).lean<{ projectUrl?: string; videoUrl?: string }>();
    expect(cleared?.projectUrl).toBeUndefined();
    expect(cleared?.videoUrl).toBeUndefined();
  });

  it("only staff with content permission can edit case studies", async () => {
    await expectRejects(saveCaseStudy(t.clientA.actor, null, { slug: "nope-1", clientName: "X", content: { title: "X title" } }), 403);
  });
});
