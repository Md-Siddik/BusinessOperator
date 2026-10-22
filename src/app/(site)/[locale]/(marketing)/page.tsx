import type { Metadata } from "next";
import { buildMetadata } from "@/lib/i18n/seo";
import { getPublicContext, type LocaleParams } from "@/features/site/context";
import { listPublicServices } from "@/features/service-catalog/service";
import { CtaBand, HomeHero, Principles } from "@/components/site/sections";
import { EngagementModels } from "@/components/site/engagement-models";
import { BuildFirstModel } from "@/components/site/build-first";
import { DigitalSideSection } from "@/components/site/digital-side";
import { InfrastructureSection } from "@/components/site/infrastructure";

/** Re-render periodically (and on every Service Management change) so featured services stay current. */
export const revalidate = 600;

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  const { t, enabledLanguages } = await getPublicContext(locale);
  const meta = buildMetadata({ locale, path: "/", title: t("meta.pages.home.title"), description: t("meta.pages.home.description"), enabledLanguages });
  return { ...meta, title: { absolute: t("meta.pages.home.title") } };
}

export default async function HomePage({ params }: LocaleParams) {
  const { locale } = await params;
  const { t, list } = await getPublicContext(locale);
  const services = await listPublicServices(locale);
  // The homepage stays curated: only the services the Owner marked "Featured", in their order.
  const featured = services.filter((s) => s.featured);

  // Story: the promise (hero) → you run the business, we run the digital side → one digital
  // infrastructure, adapted to the need → how working together can start (build first, then the
  // engagement models) → how we operate → one clear next step.
  // No portfolio section until there are real, published client projects.
  return (
    <>
      <HomeHero locale={locale} t={t} />
      <DigitalSideSection t={t} list={list} />
      <InfrastructureSection locale={locale} t={t} list={list} featured={featured} />
      <BuildFirstModel locale={locale} t={t} list={list} />
      <EngagementModels locale={locale} t={t} list={list} />
      <Principles t={t} list={list} />
      <CtaBand locale={locale} t={t} />
    </>
  );
}
