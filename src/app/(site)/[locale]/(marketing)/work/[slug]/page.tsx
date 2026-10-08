import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, Info } from "lucide-react";
import { localizedPath } from "@/config/languages";
import { buildMetadata } from "@/lib/i18n/seo";
import { getPublicContext } from "@/features/site/context";
import { getPublishedCaseStudy } from "@/features/content/service";
import { Badge } from "@/components/ui/badge";
import { CtaBand, Eyebrow } from "@/components/site/sections";

type Params = { params: Promise<{ locale: string; slug: string }> };
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, slug } = await params;
  const { enabledLanguages } = await getPublicContext(locale);
  const cs = await getPublishedCaseStudy(slug, locale);
  if (!cs) return {};
  return buildMetadata({ locale, path: `/work/${slug}`, title: cs.title, description: cs.summary ?? cs.title, enabledLanguages });
}

export default async function CaseStudyPage({ params }: Params) {
  const { locale, slug } = await params;
  const { t } = await getPublicContext(locale);
  const cs = await getPublishedCaseStudy(slug, locale);
  if (!cs) notFound();
  return (
    <>
      <article className="py-14 sm:py-20">
        <div className="container-page max-w-3xl">
          <Link href={localizedPath(locale, "/work")} className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800">
            <ArrowLeft className="h-4 w-4" aria-hidden /> {t("work.backToWork")}
          </Link>
          <div className="mt-8 flex flex-wrap gap-2">
            {cs.isExample && <Badge tone="demo">{t("work.exampleBadge")}</Badge>}
            {cs.industry && <Badge>{t(`industries.${cs.industry}`)}</Badge>}
          </div>
          <h1 className="mt-4 text-balance text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">{cs.title}</h1>
          <p className="mt-4 text-sm text-ink-500">{cs.clientName}</p>
          {cs.isExample && (
            <p className="mt-6 flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="note">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {t("work.exampleNotice")}
            </p>
          )}
          {cs.summary && <p className="mt-8 text-lg leading-relaxed text-ink-700">{cs.summary}</p>}

          <div className="mt-12 grid gap-8">
            {cs.challenge && (
              <section>
                <Eyebrow>{t("work.challenge")}</Eyebrow>
                <p className="mt-3 leading-relaxed text-ink-700">{cs.challenge}</p>
              </section>
            )}
            {cs.solution && (
              <section>
                <Eyebrow>{t("work.solution")}</Eyebrow>
                <p className="mt-3 leading-relaxed text-ink-700">{cs.solution}</p>
              </section>
            )}
            {cs.results.length > 0 && (
              <section>
                <Eyebrow>{t("work.results")}</Eyebrow>
                <ul className="mt-3 space-y-2">
                  {cs.results.map((r) => (
                    <li key={r} className="flex gap-3 text-ink-700">
                      <Check className="mt-1 h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> {r}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className="grid gap-6 rounded-2xl border border-ink-200 bg-ink-50/60 p-6 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{t("work.services")}</p>
                <ul className="mt-3 space-y-1.5 text-sm text-ink-800">
                  {cs.services.map((s) => (
                    <li key={s}>{t(`serviceItems.${s}`)}</li>
                  ))}
                </ul>
              </div>
              {cs.technologies.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{t("work.technologies")}</p>
                  <ul className="mt-3 space-y-1.5 text-sm text-ink-800">
                    {cs.technologies.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
            {cs.testimonial && !cs.isExample && (
              <blockquote className="border-l-2 border-brand-500 pl-5 font-serif text-xl italic text-ink-800">
                “{cs.testimonial}”{cs.testimonialAuthor && <footer className="mt-2 font-sans text-sm not-italic text-ink-500">— {cs.testimonialAuthor}</footer>}
              </blockquote>
            )}
          </div>
        </div>
      </article>
      <CtaBand locale={locale} t={t} />
    </>
  );
}
