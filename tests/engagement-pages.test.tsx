import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

/**
 * Public homepage, the engagement model pages (/how-we-work/monthly, /task-based,
 * /growth-partnership), the build-first page and the redirects from the former
 * /engagement/<slug> addresses. Pages are rendered as the server renders them.
 */
const HomePage = (await import("@/app/(site)/[locale]/(marketing)/page")).default;
const ModelPage = (await import("@/app/(site)/[locale]/(marketing)/how-we-work/[model]/page")).default;
const modelMeta = (await import("@/app/(site)/[locale]/(marketing)/how-we-work/[model]/page")).generateMetadata;
const BuildFirstPage = (await import("@/app/(site)/[locale]/(marketing)/how-we-work/build-first/page")).default;
const HowWeWorkPage = (await import("@/app/(site)/[locale]/(marketing)/how-we-work/page")).default;
const LegacyRedirect = (await import("@/app/(site)/[locale]/(marketing)/engagement/[slug]/page")).default;

const html = async (el: Promise<ReactElement> | ReactElement) => renderToStaticMarkup(await el);
const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

/** Next's redirect()/notFound() throw an error whose digest names the outcome. */
async function outcome(run: () => Promise<unknown>) {
  try {
    await run();
    return "rendered";
  } catch (e) {
    return String((e as { digest?: string }).digest ?? e);
  }
}

describe("Engagement model pages", () => {
  it.each([
    ["monthly", "Monthly Partnership", "Discuss a Monthly Partnership", "/contact?engagement=monthly"],
    ["task-based", "Task-Based Engagement", "Submit a Project Inquiry", "/contact?engagement=project"],
    ["growth-partnership", "Growth Partnership", "Discuss a Growth Partnership", "/contact?engagement=growth"],
  ])("/how-we-work/%s renders a real page with Home navigation and a working CTA", async (slug, title, cta, contact) => {
    const page = await html(ModelPage(params({ locale: "en", model: slug })));
    expect(page).toContain(`<h1`);
    expect(page).toContain(title);
    expect(page).toContain(cta);
    expect(page).toContain(`href="${contact}"`);
    expect(page).toContain('href="/"'); // Home
    expect(page).toContain('href="/how-we-work"');
    expect(page).toContain("Who it suits");
    const meta = await modelMeta(params({ locale: "en", model: slug }));
    expect(meta.alternates?.canonical).toContain(`/how-we-work/${slug}`);
    expect(String(meta.description).length).toBeGreaterThan(40);
  });

  it("presents the growth partnership as selective and individually negotiated — never a payment plan", async () => {
    const page = await html(ModelPage(params({ locale: "en", model: "growth-partnership" })));
    expect(page).toContain("Growth Partnership is not a standard payment plan. It is a selective arrangement individually discussed and negotiated between ExploreTechify and the business.");
    expect(page).toContain("For selected businesses looking for a deeper long-term relationship.");
    for (const s of ["Profit-sharing", "Equity / shareholding", "How a partnership is explored"]) expect(page).toContain(s);
    expect(page).not.toMatch(/guaranteed (growth|return|results)|\d+\s?% (equity|share|profit)/i);
  });

  it("is available in Norwegian", async () => {
    const page = await html(ModelPage(params({ locale: "no", model: "monthly" })));
    expect(page).toContain("Hvem passer det for");
    expect(page).toContain('href="/no/how-we-work"');
  });

  it("returns 404 for unknown models", async () => {
    expect(await outcome(() => ModelPage(params({ locale: "en", model: "plan-3" })))).toContain("404");
  });

  it("permanently redirects the former /engagement/<slug> addresses, keeping the language", async () => {
    expect(await outcome(() => LegacyRedirect(params({ locale: "en", slug: "monthly-partnership" })))).toMatch(/NEXT_REDIRECT;replace;\/how-we-work\/monthly;308/);
    expect(await outcome(() => LegacyRedirect(params({ locale: "no", slug: "task-based" })))).toMatch(/NEXT_REDIRECT;replace;\/no\/how-we-work\/task-based;308/);
    expect(await outcome(() => LegacyRedirect(params({ locale: "en", slug: "growth-partnership" })))).toMatch(/\/how-we-work\/growth-partnership;308/);
    expect(await outcome(() => LegacyRedirect(params({ locale: "en", slug: "nope" })))).toContain("404");
  });
});

describe("Build before you commit", () => {
  it("explains what is built, reviewed, paid and delivered — and that it is not free or a fourth plan", async () => {
    const page = await html(BuildFirstPage(params({ locale: "en" })));
    for (const s of [
      "Build first. Review with confidence. Commit when you&#x27;re ready.",
      "Build, review, approve and pay",
      "Pay, then we build and deliver",
      "What is built first",
      "When payment happens",
      "When you receive the final website and code",
      "Not free development — the price is agreed before we start",
      "Not a fourth payment plan",
    ])
      expect(page).toContain(s);
    expect(page).toContain('href="/contact?need=website&amp;engagement=project"');
    expect(page).not.toMatch(/free website|100% free|no cost/i);
  });
});

describe("Homepage", () => {
  it("keeps the hero CTAs, shows build-first and the three models, and no portfolio section", async () => {
    const page = await html(HomePage(params({ locale: "en" })));
    expect(page).toContain("Websites That Turn Visitors Into Customers.".slice(0, 20));
    expect(page).toContain("Let&#x27;s Work Together");
    expect(page).toContain('href="/contact"');
    expect(page).toContain("Explore Services");
    expect(page).toContain('href="/services"');
    // Build before you commit replaces "Our work / See what we build" for now.
    expect(page).toContain("See what we can build before you make the final commitment");
    expect(page).toContain('href="/how-we-work/build-first"');
    expect(page).not.toContain("See what we build");
    expect(page).not.toContain("Video walkthroughs are being prepared");
    // The three engagement models link to real pages; growth is separate, not a plan.
    for (const slug of ["monthly", "task-based", "growth-partnership"]) expect(page).toContain(`href="/how-we-work/${slug}"`);
    expect(page).not.toContain("/engagement/");
    expect(page).not.toMatch(/Plan 3|Payment option 3/i);
  });

  it("is available in Norwegian", async () => {
    const page = await html(HomePage(params({ locale: "no" })));
    expect(page).toContain("Se hva vi kan bygge før du tar den endelige beslutningen");
    expect(page).toContain('href="/no/how-we-work/growth-partnership"');
  });

  it("the How we work hub links to the three models and build-first", async () => {
    const page = await html(HowWeWorkPage(params({ locale: "en" })));
    for (const p of ["/how-we-work/monthly", "/how-we-work/task-based", "/how-we-work/growth-partnership", "/how-we-work/build-first"]) expect(page).toContain(`href="${p}"`);
  });
});
