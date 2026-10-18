import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, ChevronDown, X } from "lucide-react";
import { BUILD_FIRST_PATH } from "@/config/engagement";
import { localizedPath } from "@/config/languages";
import { absoluteUrl } from "@/config/site";
import { buildMetadata } from "@/lib/i18n/seo";
import { getPublicContext, type LocaleParams } from "@/features/site/context";
import { ButtonLink } from "@/components/ui/button";
import { Eyebrow, SectionHeading } from "@/components/site/sections";
import { BuildFirstSection, buildFirstContactHref } from "@/components/site/build-first";
import { EngagementModels } from "@/components/site/engagement-models";

type Option = { label: string; title: string; text: string; points: string[] };

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  const { t, enabledLanguages } = await getPublicContext(locale);
  return buildMetadata({ locale, path: BUILD_FIRST_PATH, title: t("buildFirst.page.metaTitle"), description: t("buildFirst.page.metaDescription"), enabledLanguages });
}

/**
 * "Build before you commit" — how a website project can start with less uncertainty.
 * States plainly what is built first, what is reviewed, when payment and delivery happen,
 * and that it is neither free development nor a fourth payment model.
 */
export default async function BuildFirstPage({ params }: LocaleParams) {
  const { locale } = await params;
  const { t, list, raw } = await getPublicContext(locale);
  const pk = "buildFirst.page";
  const options = [raw<Option>(`${pk}.optionA`), raw<Option>(`${pk}.optionB`)].filter((o): o is Option => !!o);
  const faq = raw<{ q: string; a: string }[]>(`${pk}.faq`) ?? [];
  const contact = buildFirstContactHref(locale);
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: t("nav.home"), item: absoluteUrl(localizedPath(locale, "/")) },
        { "@type": "ListItem", position: 2, name: t("engagementPages.ui.breadcrumb"), item: absoluteUrl(localizedPath(locale, "/how-we-work")) },
        { "@type": "ListItem", position: 3, name: t(`${pk}.metaTitle`), item: absoluteUrl(localizedPath(locale, BUILD_FIRST_PATH)) },
      ],
    },
    ...(faq.length ? [{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }] : []),
  ];

  return (
    <>
      <section className="relative isolate overflow-hidden border-b border-ink-100">
        <div className="bg-grid pointer-events-none absolute inset-0 -z-10 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" aria-hidden />
        <div className="container-page py-16 sm:py-24">
          <div className="max-w-3xl animate-fade-up">
            <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-x-2 text-sm text-ink-500">
              <Link href={localizedPath(locale, "/")} className="hover:text-ink-800">
                {t("nav.home")}
              </Link>
              <span aria-hidden>/</span>
              <Link href={localizedPath(locale, "/how-we-work")} className="hover:text-ink-800">
                {t("engagementPages.ui.breadcrumb")}
              </Link>
              <span aria-hidden>/</span>
              <span className="text-ink-800">{t(`${pk}.metaTitle`)}</span>
            </nav>
            <Eyebrow>{t("buildFirst.eyebrow")}</Eyebrow>
            <h1 className="mt-4 text-balance text-4xl font-semibold tracking-[-0.03em] text-ink-900 sm:text-5xl">{t(`${pk}.heroTitle`)}</h1>
            <p className="mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-ink-600">{t(`${pk}.heroSubtitle`)}</p>
            <ButtonLink href={contact} size="lg" className="mt-8">
              {t("buildFirst.cta")} <ArrowRight className="h-4 w-4" aria-hidden />
            </ButtonLink>
          </div>
        </div>
      </section>

      {/* Two ways to start */}
      <section className="py-16 sm:py-20">
        <div className="container-page">
          <SectionHeading title={t(`${pk}.arrangementsTitle`)} />
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {options.map((o, i) => (
              <article key={o.title} className={i === 0 ? "rounded-3xl border border-brand-200 bg-brand-50/50 p-7 shadow-soft" : "rounded-3xl border border-ink-200 bg-white p-7 shadow-soft"}>
                <span className="rounded-full border border-ink-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink-600">{o.label}</span>
                <h2 className="mt-4 text-xl font-semibold tracking-tight text-ink-900">{o.title}</h2>
                <p className="mt-2 leading-relaxed text-ink-600">{o.text}</p>
                <ul className="mt-5 space-y-2.5">
                  {o.points.map((p) => (
                    <li key={p} className="flex gap-3 text-[0.9375rem] text-ink-700">
                      <Check className="mt-1 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                      {p}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* The process (shared with the homepage) */}
      <div className="border-y border-ink-100 bg-white">
        <BuildFirstSection locale={locale} t={t} list={list} showLearnMore={false} />
      </div>

      {/* What is built, reviewed, paid and delivered */}
      <section className="py-16 sm:py-20">
        <div className="container-page grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-ink-200 bg-white p-6 shadow-soft sm:p-7">
            <h2 className="text-lg font-semibold tracking-tight text-ink-900">{t(`${pk}.whatTitle`)}</h2>
            <ul className="mt-4 space-y-2.5">
              {list<string>(`${pk}.whatItems`).map((x) => (
                <li key={x} className="flex gap-3 text-ink-700">
                  <Check className="mt-1 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                  {x}
                </li>
              ))}
            </ul>
          </div>
          {(["review", "payment", "delivery"] as const).map((key) => (
            <div key={key} className="rounded-2xl border border-ink-200 bg-white p-6 shadow-soft sm:p-7">
              <h2 className="text-lg font-semibold tracking-tight text-ink-900">{t(`${pk}.${key}Title`)}</h2>
              <p className="mt-3 leading-relaxed text-ink-600">{t(`${pk}.${key}Text`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Agreed before we start / what it is not */}
      <section className="border-y border-ink-100 bg-[#f5f7fb] py-16 sm:py-20">
        <div className="container-page grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-soft sm:p-7">
            <h2 className="text-lg font-semibold tracking-tight text-ink-900">{t(`${pk}.agreedTitle`)}</h2>
            <ul className="mt-4 space-y-2.5">
              {list<string>(`${pk}.agreedItems`).map((x) => (
                <li key={x} className="flex gap-3 text-ink-700">
                  <Check className="mt-1 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                  {x}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-ink-200 bg-white p-6 shadow-soft sm:p-7">
            <h2 className="text-lg font-semibold tracking-tight text-ink-900">{t(`${pk}.notTitle`)}</h2>
            <ul className="mt-4 space-y-2.5">
              {list<string>(`${pk}.notItems`).map((x) => (
                <li key={x} className="flex gap-3 text-ink-700">
                  <X className="mt-1 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
                  {x}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {faq.length > 0 && (
        <section className="py-16 sm:py-20">
          <div className="container-page max-w-3xl">
            <SectionHeading title={t("servicePages.ui.faqTitle")} />
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

      {/* Build-first is an approach; the way of working is still one of the three models. */}
      <div className="border-t border-ink-100 bg-[#f5f7fb]">
        <EngagementModels locale={locale} t={t} list={list} />
      </div>

      <section className="py-16 sm:py-24">
        <div className="container-page">
          <div className="relative isolate overflow-hidden rounded-3xl bg-night-900 px-6 py-14 text-center shadow-lifted sm:px-12 sm:py-16">
            <div className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-80 w-[40rem] -translate-x-1/2 rounded-full bg-brand-600/30 blur-3xl" aria-hidden />
            <h2 className="mx-auto max-w-2xl text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">{t(`${pk}.ctaTitle`)}</h2>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-ink-300">{t(`${pk}.ctaText`)}</p>
            <ButtonLink href={contact} size="lg" className="mt-8 bg-white text-night-950 hover:bg-brand-50">
              {t("buildFirst.cta")} <ArrowRight className="h-4 w-4" aria-hidden />
            </ButtonLink>
          </div>
        </div>
      </section>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
    </>
  );
}
