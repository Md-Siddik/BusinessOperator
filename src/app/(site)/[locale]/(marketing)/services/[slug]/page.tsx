import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Check, ChevronDown } from "lucide-react";
import { LANGUAGE_CODES, localizedPath } from "@/config/languages";
import { SERVICE_CATEGORIES, getServiceCategory } from "@/config/services";
import { SERVICE_PAGE_SLUGS } from "@/config/service-pages";
import { listCaseStudiesForServices } from "@/features/content/service";
import { getPublicService, listPublicServices } from "@/features/service-catalog/service";
import { ServiceLanding } from "@/components/site/service-landing";
import { absoluteUrl, siteConfig } from "@/config/site";
import { buildMetadata } from "@/lib/i18n/seo";
import { getPublicContext } from "@/features/site/context";
import { ButtonLink } from "@/components/ui/button";
import { CATEGORY_ICONS, CtaBand, Eyebrow, ProcessSteps, SectionHeading } from "@/components/site/sections";

type Params = { params: Promise<{ locale: string; slug: string }> };

/**
 * Re-rendered on every Service Management change (revalidatePath) and periodically, so
 * newly published examples appear too. New services render on first request.
 */
export const revalidate = 600;

/**
 * The original service-area pages, kept for their existing URLs — only for slugs that were
 * never a service landing page, so a deactivated service really disappears.
 */
function legacyCategory(slug: string) {
  return SERVICE_PAGE_SLUGS.includes(slug) ? undefined : getServiceCategory(slug);
}

export function generateStaticParams() {
  const slugs = new Set([...SERVICE_PAGE_SLUGS, ...SERVICE_CATEGORIES.map((c) => c.slug)]);
  return LANGUAGE_CODES.flatMap((locale) => [...slugs].map((slug) => ({ locale, slug })));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, slug } = await params;
  const service = await getPublicService(slug, locale);
  if (service) {
    const { enabledLanguages } = await getPublicContext(locale);
    const meta = buildMetadata({ locale, path: `/services/${slug}`, title: service.seo.title || service.name, description: service.seo.description || service.shortDescription, enabledLanguages });
    return service.seo.noindex ? { ...meta, robots: { index: false, follow: true } } : meta;
  }
  const category = legacyCategory(slug);
  if (!category) return {};
  const { t, enabledLanguages } = await getPublicContext(locale);
  return buildMetadata({
    locale,
    path: `/services/${slug}`,
    title: t(`services.categories.${category.key}.name`),
    description: t(`services.categories.${category.key}.summary`),
    enabledLanguages,
  });
}

export default async function ServiceDetailPage({ params }: Params) {
  const { locale, slug } = await params;
  const service = await getPublicService(slug, locale);
  if (service) {
    const { t } = await getPublicContext(locale);
    const [cases, all] = await Promise.all([listCaseStudiesForServices(service.portfolioServices, locale), listPublicServices(locale)]);
    const related = service.related.map((s) => all.find((x) => x.slug === s)).filter((x): x is NonNullable<typeof x> => !!x);
    return <ServiceLanding service={service} related={related} locale={locale} t={t} cases={cases} />;
  }
  const category = legacyCategory(slug);
  if (!category) notFound();
  const { t, list, raw } = await getPublicContext(locale);
  const k = `services.categories.${category.key}`;
  const Icon = CATEGORY_ICONS[category.icon]!;
  const faq = raw<{ q: string; a: string }[]>(`${k}.faq`) ?? [];
  const others = SERVICE_CATEGORIES.filter((c) => c.slug !== slug);

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: t(`${k}.name`),
      description: t(`${k}.summary`),
      provider: { "@type": "Organization", name: siteConfig.name, url: siteConfig.url },
      areaServed: "Europe",
      url: absoluteUrl(localizedPath(locale, `/services/${slug}`)),
    },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
  ];

  return (
    <>
      <section className="relative overflow-hidden border-b border-ink-100">
        <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" aria-hidden />
        <div className="container-page relative grid gap-10 py-16 sm:py-24 lg:grid-cols-[1.4fr_1fr] lg:items-end">
          <div className="animate-fade-up">
            <nav aria-label="Breadcrumb" className="mb-6 text-sm text-ink-500">
              <Link href={localizedPath(locale, "/")} className="hover:text-ink-800">
                {t("nav.home")}
              </Link>
              <span className="mx-2" aria-hidden>
                /
              </span>
              <Link href={localizedPath(locale, "/services")} className="hover:text-ink-800">
                {t("nav.services")}
              </Link>
              <span className="mx-2" aria-hidden>
                /
              </span>
              <span className="text-ink-800">{t(`${k}.name`)}</span>
            </nav>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 ring-1 ring-brand-100">
              <Icon className="h-6 w-6" aria-hidden />
            </span>
            <Eyebrow className="mt-6">{t(`${k}.name`)}</Eyebrow>
            <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">{t(`${k}.heroTitle`)}</h1>
            <p className="mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-ink-600">{t(`${k}.heroSubtitle`)}</p>
            <ButtonLink href={localizedPath(locale, "/contact")} size="lg" className="mt-8">
              {t("cta.letsWorkTogether")} <ArrowRight className="h-4 w-4" aria-hidden />
            </ButtonLink>
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-24">
        <div className="container-page grid gap-6 md:grid-cols-2">
          <div className="rounded-3xl border border-ink-200 bg-ink-50/60 p-7">
            <Eyebrow className="text-ink-500">{t("services.detail.problemTitle")}</Eyebrow>
            <p className="mt-4 text-lg leading-relaxed text-ink-800">{t(`${k}.problem`)}</p>
          </div>
          <div className="rounded-3xl border border-brand-200 bg-brand-50/60 p-7">
            <Eyebrow>{t("services.detail.solutionTitle")}</Eyebrow>
            <p className="mt-4 text-lg leading-relaxed text-ink-800">{t(`${k}.solution`)}</p>
          </div>
        </div>
      </section>

      <section className="pb-16 sm:pb-24">
        <div className="container-page grid gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading title={t("services.detail.provideTitle")} />
            <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
              {category.items.map((item) => (
                <li key={item} className="flex items-center gap-3 rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm font-medium text-ink-800 shadow-soft">
                  <Check className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                  {t(`serviceItems.${item}`)}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <SectionHeading title={t("services.detail.whoTitle")} />
            <ul className="mt-6 space-y-3">
              {list<string>(`${k}.whoFor`).map((w) => (
                <li key={w} className="flex gap-3 text-ink-700">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden />
                  {w}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="border-y border-ink-100 bg-ink-50/50 py-16 sm:py-24">
        <div className="container-page">
          <SectionHeading title={t("services.detail.processTitle")} />
          <div className="mt-10">
            <ProcessSteps t={t} />
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-24">
        <div className="container-page grid gap-12 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <SectionHeading title={t("services.detail.deliverablesTitle")} />
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {list<string>(`${k}.deliverables`).map((d) => (
                <li key={d} className="flex gap-3 rounded-2xl border border-ink-200 bg-white p-4 text-sm text-ink-800 shadow-soft">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                  {d}
                </li>
              ))}
            </ul>
          </div>
          <div className="self-start rounded-3xl bg-brand-950 p-7 text-white shadow-lifted">
            <Eyebrow className="text-brand-200">{t("services.detail.longTermTitle")}</Eyebrow>
            <p className="mt-4 text-lg leading-relaxed text-brand-50">{t(`${k}.longTerm`)}</p>
            <ButtonLink href={localizedPath(locale, "/contact")} className="mt-6 bg-white text-ink-900 hover:bg-brand-50">
              {t("cta.needOngoingSupport")}
            </ButtonLink>
          </div>
        </div>
      </section>

      {faq.length > 0 && (
        <section className="border-t border-ink-100 py-16 sm:py-24">
          <div className="container-page max-w-3xl">
            <SectionHeading title={t("services.detail.faqTitle")} />
            <div className="mt-8 divide-y divide-ink-200 rounded-2xl border border-ink-200 bg-white">
              {faq.map((f) => (
                <details key={f.q} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-medium text-ink-900">
                    {f.q}
                    <ChevronDown className="h-4 w-4 shrink-0 text-ink-400 transition-transform group-open:rotate-180" aria-hidden />
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-ink-600">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="pb-4">
        <div className="container-page">
          <p className="text-sm font-semibold text-ink-900">{t("services.detail.otherServices")}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {others.map((o) => (
              <Link key={o.slug} href={localizedPath(locale, `/services/${o.slug}`)} className="rounded-full border border-ink-200 bg-white px-4 py-2 text-sm text-ink-700 hover:border-brand-200 hover:text-brand-700">
                {t(`services.categories.${o.key}.name`)}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <CtaBand locale={locale} t={t} title={t("services.detail.ctaTitle")} subtitle={t("services.detail.ctaSubtitle")} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
    </>
  );
}
