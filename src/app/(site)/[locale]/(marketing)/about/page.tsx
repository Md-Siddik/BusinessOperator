import type { Metadata } from "next";
import { buildMetadata } from "@/lib/i18n/seo";
import { getPublicContext, type LocaleParams } from "@/features/site/context";
import { CtaBand, Eyebrow, PageHero, SectionHeading } from "@/components/site/sections";

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  const { t, enabledLanguages } = await getPublicContext(locale);
  return buildMetadata({ locale, path: "/about", title: t("meta.pages.about.title"), description: t("meta.pages.about.description"), enabledLanguages });
}

export default async function AboutPage({ params }: LocaleParams) {
  const { locale } = await params;
  const { t, list } = await getPublicContext(locale);
  const values = list<{ title: string; text: string }>("about.values");
  return (
    <>
      <PageHero eyebrow={t("about.eyebrow")} title={t("about.title")} subtitle={t("about.subtitle")} />
      <section className="py-16 sm:py-24">
        <div className="container-page grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl bg-brand-950 p-8 text-white shadow-lifted sm:p-10">
            <Eyebrow className="text-brand-200">{t("about.missionTitle")}</Eyebrow>
            <p className="mt-5 font-serif text-2xl leading-snug italic sm:text-3xl">{t("about.missionText")}</p>
          </div>
          <div className="rounded-3xl border border-ink-200 bg-white p-8 shadow-card sm:p-10">
            <Eyebrow>{t("about.europeTitle")}</Eyebrow>
            <p className="mt-5 text-lg leading-relaxed text-ink-700">{t("about.europeText")}</p>
            <p className="mt-6 border-t border-ink-100 pt-6 text-sm leading-relaxed text-ink-600">{t("howWeWork.partnershipText")}</p>
          </div>
        </div>
      </section>
      <section className="border-t border-ink-100 py-16 sm:py-24">
        <div className="container-page">
          <SectionHeading title={t("about.valuesTitle")} />
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {values.map((v, i) => (
              <div key={v.title} className="rounded-2xl border border-ink-200 bg-white p-6 shadow-soft">
                <span className="font-serif text-2xl italic text-brand-600">0{i + 1}</span>
                <h3 className="mt-3 text-base font-semibold text-ink-900">{v.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{v.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <CtaBand locale={locale} t={t} />
    </>
  );
}
