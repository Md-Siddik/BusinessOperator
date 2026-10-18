import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { INDUSTRY_PROFILES } from "@/config/industries";
import { localizedPath } from "@/config/languages";
import { SERVICE_CATEGORIES } from "@/config/services";
import { buildMetadata } from "@/lib/i18n/seo";
import { getPublicContext, type LocaleParams } from "@/features/site/context";
import { CATEGORY_ICONS, CtaBand, PageHero, SectionHeading } from "@/components/site/sections";
import { IndustryProfiles } from "@/components/site/industry-profiles";
import { ServiceCardsGrid } from "@/components/site/service-landing";
import { listPublicServices } from "@/features/service-catalog/service";

/** Updated on every Service Management change (revalidatePath) and periodically. */
export const revalidate = 600;

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  const { t, enabledLanguages } = await getPublicContext(locale);
  return buildMetadata({ locale, path: "/services", title: t("meta.pages.services.title"), description: t("meta.pages.services.description"), enabledLanguages });
}

/** Prospect-ready overview: what we do, organised in six areas, with industry combinations. */
export default async function ServicesPage({ params }: LocaleParams) {
  const { locale } = await params;
  const { t } = await getPublicContext(locale);
  const services = await listPublicServices(locale);
  const profiles = INDUSTRY_PROFILES.map((p) => ({
    key: p.key,
    title: t(`home.industries.profiles.${p.key}.title`),
    text: t(`home.industries.profiles.${p.key}.text`),
    items: p.items.map((i) => t(`serviceItems.${i}`)),
  }));
  return (
    <>
      <PageHero eyebrow={t("services.overview.eyebrow")} title={t("services.overview.title")} subtitle={t("services.overview.subtitle")} />
      <section className="py-16 sm:py-24">
        <div className="container-page">
          <SectionHeading eyebrow={t("homeV2.services.eyebrow")} title={t("homeV2.services.title")} subtitle={t("homeV2.services.subtitle")} />
          <div className="mt-10">
            <ServiceCardsGrid services={services} locale={locale} t={t} />
          </div>
        </div>
      </section>
      <section className="border-t border-ink-100 pb-16 pt-16 sm:pb-24 sm:pt-24">
        <div className="container-page">
          <SectionHeading title={t("servicePages.ui.areasTitle")} subtitle={t("servicePages.ui.areasSubtitle")} />
        </div>
        <div className="container-page mt-10 space-y-5">
          {SERVICE_CATEGORIES.map((c, i) => {
            const Icon = CATEGORY_ICONS[c.icon]!;
            return (
              <article key={c.slug} className="grid gap-6 rounded-3xl border border-ink-200 bg-white p-6 shadow-soft transition-shadow hover:shadow-card sm:p-8 lg:grid-cols-[1fr_1.4fr]">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100">
                      <Icon className="h-5 w-5" aria-hidden />
                    </span>
                    <span className="text-xs font-medium tabular-nums text-ink-400">0{i + 1}</span>
                  </div>
                  <h2 className="mt-5 text-2xl font-semibold tracking-tight text-ink-900">{t(`services.categories.${c.key}.name`)}</h2>
                  <p className="mt-1 font-medium text-brand-700">{t(`services.categories.${c.key}.tagline`)}</p>
                  <p className="mt-3 text-sm leading-relaxed text-ink-600">{t(`services.categories.${c.key}.summary`)}</p>
                  <Link href={localizedPath(locale, `/services/${c.slug}`)} className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-800">
                    {t("cta.viewService")} <ArrowUpRight className="h-4 w-4" aria-hidden />
                  </Link>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">{t("services.overview.includes")}</p>
                  <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                    {c.items.map((item) => (
                      <li key={item} className="rounded-xl border border-ink-100 bg-ink-50/70 px-4 py-2.5 text-sm font-medium text-ink-800">
                        {t(`serviceItems.${item}`)}
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            );
          })}
        </div>
      </section>
      <section className="border-y border-ink-100 bg-ink-50/50 py-20 sm:py-24">
        <div className="container-page">
          <SectionHeading title={t("services.overview.industryTitle")} subtitle={t("services.overview.industrySubtitle")} />
          <div className="mt-10">
            <IndustryProfiles profiles={profiles} />
          </div>
        </div>
      </section>
      <CtaBand locale={locale} t={t} title={t("services.detail.ctaTitle")} subtitle={t("services.detail.ctaSubtitle")} />
    </>
  );
}
