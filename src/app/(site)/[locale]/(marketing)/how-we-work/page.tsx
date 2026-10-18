import type { Metadata } from "next";
import { buildMetadata } from "@/lib/i18n/seo";
import { getPublicContext, type LocaleParams } from "@/features/site/context";
import { CtaBand, Eyebrow, MoreThanWebsite, PageHero, PROCESS_STEPS } from "@/components/site/sections";
import { EngagementModels } from "@/components/site/engagement-models";
import { BuildFirstTeaser } from "@/components/site/build-first";

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  const { t, enabledLanguages } = await getPublicContext(locale);
  return buildMetadata({ locale, path: "/how-we-work", title: t("meta.pages.howWeWork.title"), description: t("meta.pages.howWeWork.description"), enabledLanguages });
}

export default async function HowWeWorkPage({ params }: LocaleParams) {
  const { locale } = await params;
  const { t, list } = await getPublicContext(locale);
  return (
    <>
      <PageHero eyebrow={t("howWeWork.eyebrow")} title={t("howWeWork.title")} subtitle={t("howWeWork.subtitle")} />
      <section className="py-16 sm:py-24">
        <div className="container-page max-w-4xl">
          <ol className="relative space-y-4 before:absolute before:bottom-6 before:left-6 before:top-6 before:w-px before:bg-ink-200 sm:before:left-7">
            {PROCESS_STEPS.map((step, i) => (
              <li key={step} className="relative flex gap-5 sm:gap-7">
                <span className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-brand-200 bg-white font-serif text-lg italic text-brand-700 shadow-soft sm:h-14 sm:w-14 sm:text-xl">0{i + 1}</span>
                <div className="flex-1 rounded-2xl border border-ink-200 bg-white p-6 shadow-soft">
                  <h2 className="text-xl font-semibold tracking-tight text-ink-900">{t(`process.${step}.title`)}</h2>
                  <p className="mt-1 text-sm font-medium text-brand-700">{t(`process.${step}.text`)}</p>
                  <p className="mt-3 leading-relaxed text-ink-600">{t(`howWeWork.details.${step}`)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <section className="border-y border-ink-100 bg-ink-50/50 py-16 sm:py-20">
        <div className="container-page grid gap-6 lg:grid-cols-[1fr_1.4fr] lg:items-center">
          <div>
            <Eyebrow>{t("home.principles.eyebrow")}</Eyebrow>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink-900">{t("howWeWork.partnershipTitle")}</h2>
          </div>
          <p className="text-lg leading-relaxed text-ink-600">{t("howWeWork.partnershipText")}</p>
        </div>
      </section>
      {/* The three ways to work together (detail pages under /how-we-work/<model>) and build-first. */}
      <EngagementModels locale={locale} t={t} list={list} />
      <section className="pb-16 sm:pb-20">
        <div className="container-page max-w-6xl">
          <BuildFirstTeaser locale={locale} t={t} />
        </div>
      </section>
      <MoreThanWebsite locale={locale} t={t} list={list} />
      <CtaBand locale={locale} t={t} />
    </>
  );
}
