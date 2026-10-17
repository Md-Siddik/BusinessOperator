import type { Metadata } from "next";
import { INDUSTRY_PROFILES } from "@/config/industries";
import { buildMetadata } from "@/lib/i18n/seo";
import { getPublicContext, type LocaleParams } from "@/features/site/context";
import { CtaBand, GrowthJourney, HomeHero, MoreThanWebsite, SectionHeading, ServicePillars, SplitSection } from "@/components/site/sections";
import { IndustryProfiles } from "@/components/site/industry-profiles";
import { EngagementModels } from "@/components/site/engagement-models";

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  const { t, enabledLanguages } = await getPublicContext(locale);
  const meta = buildMetadata({ locale, path: "/", title: t("meta.pages.home.title"), description: t("meta.pages.home.description"), enabledLanguages });
  return { ...meta, title: { absolute: t("meta.pages.home.title") } };
}

export default async function HomePage({ params }: LocaleParams) {
  const { locale } = await params;
  const { t, list } = await getPublicContext(locale);
  const profiles = INDUSTRY_PROFILES.map((p) => ({
    key: p.key,
    title: t(`home.industries.profiles.${p.key}.title`),
    text: t(`home.industries.profiles.${p.key}.text`),
    items: p.items.map((i) => t(`serviceItems.${i}`)),
  }));
  const principles = list<{ title: string; text: string }>("home.principles.items");

  // Story: what we do (hero) → why it matters → how it works → what supports it → the long-term
  // relationship → who it fits → how we operate → how to work together → talk to us.
  return (
    <>
      <HomeHero locale={locale} t={t} />
      <SplitSection t={t} list={list} />
      <GrowthJourney locale={locale} t={t} list={list} />

      <section className="py-20 sm:py-28">
        <div className="container-page">
          <ServicePillars locale={locale} t={t} />
        </div>
      </section>

      <MoreThanWebsite locale={locale} t={t} list={list} />

      <section className="py-20 sm:py-28">
        <div className="container-page">
          <SectionHeading eyebrow={t("home.industries.eyebrow")} title={t("home.industries.title")} subtitle={t("home.industries.subtitle")} />
          <div className="mt-12">
            <IndustryProfiles profiles={profiles} />
          </div>
        </div>
      </section>

      <section className="border-y border-ink-100 bg-[#f5f7fb] py-20 sm:py-28">
        <div className="container-page">
          <SectionHeading eyebrow={t("home.principles.eyebrow")} title={t("home.principles.title")} align="center" />
          <div className="mx-auto mt-12 grid max-w-5xl gap-4 md:grid-cols-3">
            {principles.map((p, i) => (
              <div key={p.title} className="rounded-2xl border border-ink-200 bg-white p-6 shadow-soft">
                <span className="text-xs font-semibold tabular-nums text-brand-600">0{i + 1}</span>
                <h3 className="mt-2 text-base font-semibold text-ink-900">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{p.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <EngagementModels locale={locale} t={t} list={list} />

      <CtaBand locale={locale} t={t} />
    </>
  );
}
