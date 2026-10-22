import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Check, Info } from "lucide-react";
import { LANGUAGE_CODES, localizedPath } from "@/config/languages";
import { ENGAGEMENT_MODELS, engagementPath, getEngagementModel, type EngagementModelConfig } from "@/config/engagement";
import { absoluteUrl } from "@/config/site";
import { buildMetadata } from "@/lib/i18n/seo";
import type { Translator } from "@/lib/i18n/translator";
import { getPublicContext } from "@/features/site/context";
import { ButtonLink } from "@/components/ui/button";
import { Eyebrow, SectionHeading } from "@/components/site/sections";
import { ENGAGEMENT_ICONS } from "@/components/site/engagement-models";
import { BuildFirstTeaser } from "@/components/site/build-first";
import { cn } from "@/lib/utils";

type Params = { params: Promise<{ locale: string; model: string }> };
type Block = { title: string; text?: string; items?: string[]; structures?: { title: string; text: string }[] };
type Step = { title: string; text: string };

const META_KEY: Record<EngagementModelConfig["key"], string> = { monthly: "metaMonthly", project: "metaProject", growth: "metaGrowth" };

export function generateStaticParams() {
  return LANGUAGE_CODES.flatMap((locale) => ENGAGEMENT_MODELS.map((m) => ({ locale, model: m.slug })));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, model: slug } = await params;
  const model = getEngagementModel(slug);
  if (!model) return {};
  const { t, enabledLanguages } = await getPublicContext(locale);
  return buildMetadata({ locale, path: engagementPath(model), title: t(`engagement.models.${model.key}.title`), description: t(`engagementPages.ui.${META_KEY[model.key]}`), enabledLanguages });
}

function Breadcrumb({ locale, t, title, dark }: { locale: string; t: Translator["t"]; title: string; dark?: boolean }) {
  const link = dark ? "hover:text-white" : "hover:text-ink-800";
  return (
    <nav aria-label="Breadcrumb" className={cn("mb-6 flex flex-wrap items-center gap-x-2 text-sm", dark ? "text-ink-400" : "text-ink-500")}>
      <Link href={localizedPath(locale, "/")} className={link}>
        {t("nav.home")}
      </Link>
      <span aria-hidden>/</span>
      <Link href={localizedPath(locale, "/how-we-work")} className={link}>
        {t("engagementPages.ui.breadcrumb")}
      </Link>
      <span aria-hidden>/</span>
      <span className={dark ? "text-white" : "text-ink-800"}>{title}</span>
    </nav>
  );
}

function Steps({ steps, dark }: { steps: Step[]; dark?: boolean }) {
  return (
    <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map((s, i) => (
        <li key={s.title} className={cn("rounded-2xl border p-5", dark ? "border-white/10 bg-white/[0.04]" : "border-ink-200 bg-white shadow-soft")}>
          <span className={cn("flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold tabular-nums", dark ? "bg-white/10 text-signal-300" : "border border-brand-200 bg-brand-50 text-brand-700")}>0{i + 1}</span>
          <h3 className={cn("mt-4 text-base font-semibold", dark ? "text-white" : "text-ink-900")}>{s.title}</h3>
          <p className={cn("mt-1.5 text-sm leading-relaxed", dark ? "text-ink-300" : "text-ink-600")}>{s.text}</p>
        </li>
      ))}
    </ol>
  );
}

/**
 * Engagement model detail pages: /how-we-work/monthly, /task-based, /growth-partnership.
 * The growth partnership gets its own, darker composition and is stated plainly to be a
 * selective, individually negotiated arrangement — not a payment plan.
 */
export default async function EngagementModelPage({ params }: Params) {
  const { locale, model: slug } = await params;
  const model = getEngagementModel(slug);
  if (!model) notFound();
  const { t, list } = await getPublicContext(locale);
  const k = `engagement.models.${model.key}`;
  const p = `engagementPages.${model.key}`;
  const Icon = ENGAGEMENT_ICONS[model.key]!;
  const growth = model.key === "growth";
  const title = t(`${k}.title`);
  const contactHref = `${localizedPath(locale, "/contact")}?engagement=${model.key}`;
  const others = ENGAGEMENT_MODELS.filter((m) => m.slug !== model.slug);
  const sections = list<Block>(`${k}.sections`);
  const structureBlock = sections.find((b) => b.structures);
  const structures = structureBlock?.structures ?? [];
  const textSections = sections.filter((b) => !b.structures);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: t("nav.home"), item: absoluteUrl(localizedPath(locale, "/")) },
      { "@type": "ListItem", position: 2, name: t("engagementPages.ui.breadcrumb"), item: absoluteUrl(localizedPath(locale, "/how-we-work")) },
      { "@type": "ListItem", position: 3, name: title, item: absoluteUrl(localizedPath(locale, engagementPath(model))) },
    ],
  };

  return (
    <>
      {/* Hero */}
      <section className={cn("relative isolate overflow-hidden", growth ? "bg-night-950 text-white" : "border-b border-ink-100")}>
        {growth ? (
          <div className="pointer-events-none absolute -right-40 -top-48 -z-10 h-[34rem] w-[34rem] rounded-full bg-brand-600/20 blur-3xl" aria-hidden />
        ) : (
          <div className="bg-grid pointer-events-none absolute inset-0 -z-10 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" aria-hidden />
        )}
        <div className="container-page py-16 sm:py-24">
          <div className="max-w-3xl animate-fade-up">
            <Breadcrumb locale={locale} t={t} title={title} dark={growth} />
            <div className="flex flex-wrap items-center gap-3">
              <span className={cn("flex h-11 w-11 items-center justify-center rounded-xl", growth ? "bg-white/10 text-signal-300 ring-1 ring-white/15" : "bg-brand-50 text-brand-700 ring-1 ring-brand-100")} aria-hidden>
                <Icon className="h-5 w-5" />
              </span>
              <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em]", growth ? "border-signal-400/35 bg-signal-400/10 text-signal-300" : "border-ink-200 bg-ink-50 text-ink-600")}>{t(`home.engagement.kinds.${model.key}`)}</span>
            </div>
            <h1 className={cn("mt-5 text-balance text-4xl font-semibold tracking-[-0.03em] sm:text-5xl", growth ? "text-white" : "text-ink-900")}>{title}</h1>
            {growth && <p className="mt-3 text-lg font-medium text-brand-200">{t(`${p}.lead`)}</p>}
            <p className={cn("mt-5 max-w-2xl text-pretty text-lg leading-relaxed", growth ? "text-ink-300" : "text-ink-600")}>{t(`${k}.subtitle`)}</p>
            {growth && (
              <p className="mt-6 flex max-w-2xl gap-3 rounded-xl border border-white/10 bg-white/[0.05] p-4 text-sm leading-relaxed text-ink-200">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-signal-400" aria-hidden />
                {t("engagementPages.ui.notAPlan")}
              </p>
            )}
            <ButtonLink href={contactHref} size="lg" className={cn("mt-8", growth && "bg-white text-night-950 hover:bg-brand-50")}>
              {t(`${k}.cta`)} <ArrowRight className="h-4 w-4" aria-hidden />
            </ButtonLink>
          </div>
        </div>
      </section>

      {/* Who it suits */}
      <section className="py-16 sm:py-20">
        <div className="container-page">
          <SectionHeading title={t("engagementPages.ui.whoForTitle")} />
          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {list<string>(`${p}.whoFor`).map((w) => (
              <li key={w} className="flex gap-3 rounded-2xl border border-ink-200 bg-white p-4 text-[0.9375rem] leading-relaxed text-ink-800 shadow-soft">
                <Check className="mt-1 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                {w}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* What it means, scope, terms — the existing, detailed explanation. */}
      <section className="border-y border-ink-100 bg-mist py-16 sm:py-20">
        <div className="container-page grid gap-4 lg:grid-cols-2">
          {textSections.map((b) => (
            <div key={b.title} className="rounded-2xl border border-ink-200 bg-white p-6 shadow-soft sm:p-7">
              <h2 className="text-lg font-semibold tracking-tight text-ink-900">{b.title}</h2>
              {b.text && <p className="mt-3 leading-relaxed text-ink-600">{b.text}</p>}
              {b.items && (
                <ul className="mt-4 space-y-2.5">
                  {b.items.map((item) => (
                    <li key={item} className="flex gap-3 text-ink-700">
                      <Check className="mt-1 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Growth partnership: the possible structures, on a premium dark band. */}
      {growth && structures.length > 0 && (
        <section className="bg-night-900 py-16 text-white sm:py-20">
          <div className="container-page">
            <SectionHeading tone="dark" title={t("engagementPages.ui.possibilitiesTitle")} subtitle={structureBlock?.text} />
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {structures.map((s) => (
                <div key={s.title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                  <h3 className="text-base font-semibold text-white">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-300">{s.text}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 max-w-3xl text-sm leading-relaxed text-ink-300">{t("engagementPages.ui.notAPlan")}</p>
          </div>
        </section>
      )}

      {/* Getting started / selection process */}
      <section className="py-16 sm:py-20">
        <div className="container-page">
          <SectionHeading title={growth ? t("engagementPages.ui.selectionTitle") : t("engagementPages.ui.gettingStartedTitle")} />
          <Steps steps={list<Step>(`${p}.steps`)} />
          {!growth && (
            <div className="mt-8">
              <BuildFirstTeaser locale={locale} t={t} />
            </div>
          )}
        </div>
      </section>

      {/* Other models */}
      <section className="border-t border-ink-100 py-12">
        <div className="container-page">
          <p className="text-sm font-semibold text-ink-900">{t("engagementPages.ui.otherModels")}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {others.map((o) => (
              <Link key={o.slug} href={localizedPath(locale, engagementPath(o))} className="rounded-full border border-ink-200 bg-white px-4 py-2 text-sm text-ink-700 hover:border-brand-200 hover:text-brand-700">
                {t(`engagement.models.${o.key}.title`)}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="pb-16 sm:pb-24">
        <div className="container-page">
          <div className="relative isolate overflow-hidden rounded-3xl bg-night-900 px-6 py-14 text-center shadow-lifted sm:px-12 sm:py-16">
            <div className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-80 w-[40rem] -translate-x-1/2 rounded-full bg-brand-600/30 blur-3xl" aria-hidden />
            <Eyebrow tone="dark">{title}</Eyebrow>
            <h2 className="mx-auto mt-3 max-w-2xl text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">{t(`${k}.ctaTitle`)}</h2>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-ink-300">{t(`${k}.ctaText`)}</p>
            <ButtonLink href={contactHref} size="lg" className="mt-8 bg-white text-night-950 hover:bg-brand-50">
              {t(`${k}.cta`)} <ArrowRight className="h-4 w-4" aria-hidden />
            </ButtonLink>
          </div>
        </div>
      </section>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
    </>
  );
}
