import type { Metadata } from "next";
import { FolderOpen } from "lucide-react";
import { buildMetadata } from "@/lib/i18n/seo";
import { getPublicContext, type LocaleParams } from "@/features/site/context";
import { listPublishedCaseStudies } from "@/features/content/service";
import { EmptyState } from "@/components/ui/feedback";
import { CtaBand, PageHero } from "@/components/site/sections";
import { VideoShowcase, WorkCard } from "@/components/site/portfolio";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  const { t, enabledLanguages } = await getPublicContext(locale);
  return buildMetadata({ locale, path: "/work", title: t("meta.pages.work.title"), description: t("meta.pages.work.description"), enabledLanguages });
}

export default async function WorkPage({ params }: LocaleParams) {
  const { locale } = await params;
  const { t } = await getPublicContext(locale);
  const cases = await listPublishedCaseStudies(locale);
  return (
    <>
      <PageHero eyebrow={t("work.eyebrow")} title={t("work.title")} subtitle={t("work.subtitle")} />
      <section className="py-16 sm:py-24">
        <div className="container-page">
          {cases.length === 0 ? (
            <EmptyState icon={FolderOpen} title={t("work.empty")} />
          ) : (
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {cases.map((c) => (
                <WorkCard key={c.slug} c={c} locale={locale} t={t} />
              ))}
            </div>
          )}
        </div>
      </section>
      <VideoShowcase cases={cases} t={t} />
      <CtaBand locale={locale} t={t} />
    </>
  );
}
