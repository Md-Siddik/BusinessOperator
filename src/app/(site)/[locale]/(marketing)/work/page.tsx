import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, FolderOpen } from "lucide-react";
import { localizedPath } from "@/config/languages";
import { buildMetadata } from "@/lib/i18n/seo";
import { getPublicContext, type LocaleParams } from "@/features/site/context";
import { listPublishedCaseStudies } from "@/features/content/service";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/feedback";
import { CtaBand, PageHero } from "@/components/site/sections";

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
                <Link key={c.slug} href={localizedPath(locale, `/work/${c.slug}`)} className="group flex flex-col rounded-3xl border border-ink-200 bg-white p-6 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lifted">
                  <div className="flex flex-wrap items-center gap-2">
                    {c.isExample && <Badge tone="demo">{t("work.exampleBadge")}</Badge>}
                    {c.industry && <Badge>{t(`industries.${c.industry}`)}</Badge>}
                  </div>
                  <h2 className="mt-4 text-xl font-semibold tracking-tight text-ink-900">{c.title}</h2>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-600">{c.summary}</p>
                  <ul className="mt-5 flex flex-wrap gap-1.5">
                    {c.services.slice(0, 4).map((s) => (
                      <li key={s} className="rounded-full bg-ink-50 px-2.5 py-1 text-xs text-ink-600">
                        {t(`serviceItems.${s}`)}
                      </li>
                    ))}
                  </ul>
                  <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
                    {t("work.readCase")} <ArrowUpRight className="h-4 w-4" aria-hidden />
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
      <CtaBand locale={locale} t={t} />
    </>
  );
}
