import Link from "next/link";
import { ArrowRight, BadgeCheck, ClipboardCheck, Eye, Info, LayoutTemplate, MessageSquareText, type LucideIcon } from "lucide-react";
import { BUILD_FIRST_PATH } from "@/config/engagement";
import { localizedPath } from "@/config/languages";
import type { Translator } from "@/lib/i18n/translator";
import { ButtonLink } from "@/components/ui/button";
import { SectionHeading } from "./sections";

type T = Translator["t"];
type Step = { title: string; text: string };

const STEP_ICONS: LucideIcon[] = [MessageSquareText, ClipboardCheck, LayoutTemplate, Eye, BadgeCheck];

/** Contact form link for a build-first website enquiry. */
export function buildFirstContactHref(locale: string) {
  return `${localizedPath(locale, "/contact")}?need=website&engagement=project`;
}

/**
 * "Build before you commit": how a website project can start with less uncertainty.
 * Deliberately NOT presented as a fourth payment model — it sits next to the engagement
 * models as an approach, with the scope and terms always agreed in writing first.
 */
export function BuildFirstSection({ locale, t, list, showLearnMore = true }: { locale: string; t: T; list: Translator["list"]; showLearnMore?: boolean }) {
  const steps = list<Step>("buildFirst.steps");
  const alt = list<string>("buildFirst.alternativeSteps");
  return (
    <section className="py-20 sm:py-28" aria-labelledby="build-first-title">
      <div className="container-page">
        <SectionHeading eyebrow={t("buildFirst.eyebrow")} title={<span id="build-first-title">{t("buildFirst.title")}</span>} subtitle={t("buildFirst.subtitle")} align="center" />

        <div className="mx-auto mt-12 max-w-6xl rounded-3xl border border-ink-200 bg-[#f5f7fb] p-4 sm:p-6 lg:p-8">
          <ol className="relative grid gap-3 lg:grid-cols-5 lg:gap-4">
            {/* The path through the steps: a vertical rail on phones, a horizontal one on desktop. */}
            <div className="pointer-events-none absolute left-[2.375rem] top-8 bottom-8 w-px bg-gradient-to-b from-brand-300 via-ink-200 to-emerald-300 lg:hidden" aria-hidden />
            <div className="pointer-events-none absolute left-[10%] right-[10%] top-[2.375rem] hidden h-px bg-gradient-to-r from-brand-300 via-ink-200 to-emerald-300 lg:block" aria-hidden />
            {steps.map((s, i) => {
              const Icon = STEP_ICONS[i] ?? BadgeCheck;
              const last = i === steps.length - 1;
              return (
                <li key={s.title} className="relative flex gap-4 rounded-2xl bg-transparent p-2 lg:flex-col lg:gap-0 lg:rounded-2xl lg:border lg:border-ink-200 lg:bg-white lg:p-5 lg:shadow-soft">
                  <span className={`relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-4 ring-[#f5f7fb] lg:ring-white ${last ? "bg-emerald-600 text-white" : "bg-night-900 text-signal-300"}`} aria-hidden>
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1 rounded-2xl border border-ink-200 bg-white p-4 shadow-soft lg:mt-4 lg:border-0 lg:p-0 lg:shadow-none">
                    <p className="text-xs font-semibold tabular-nums text-brand-600">0{i + 1}</p>
                    <h3 className="mt-0.5 text-base font-semibold tracking-tight text-ink-900">{s.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-ink-600">{s.text}</p>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-dashed border-ink-300 bg-white/70 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink-900">{t("buildFirst.alternativeTitle")}</p>
              <p className="mt-0.5 text-sm text-ink-600">{t("buildFirst.alternativeText")}</p>
            </div>
            <ol className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-ink-700" aria-label={t("buildFirst.alternativeTitle")}>
              {alt.map((a, i) => (
                <li key={a} className="flex items-center gap-1.5">
                  <span className="rounded-full border border-ink-200 bg-white px-2.5 py-1">{a}</span>
                  {i < alt.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-ink-400" aria-hidden />}
                </li>
              ))}
            </ol>
          </div>

          <p className="mt-4 flex items-start gap-2 text-sm text-ink-600">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
            {t("buildFirst.scopeNote")}
          </p>
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <ButtonLink href={buildFirstContactHref(locale)} size="lg">
            {t("buildFirst.cta")} <ArrowRight className="h-4 w-4" aria-hidden />
          </ButtonLink>
          {showLearnMore && (
            <ButtonLink href={localizedPath(locale, BUILD_FIRST_PATH)} size="lg" variant="outline">
              {t("buildFirst.learnMore")}
            </ButtonLink>
          )}
        </div>
      </div>
    </section>
  );
}

/** A compact pointer to the build-first approach (engagement and service pages). */
export function BuildFirstTeaser({ locale, t }: { locale: string; t: T }) {
  return (
    <Link href={localizedPath(locale, BUILD_FIRST_PATH)} className="group flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 transition-colors hover:border-emerald-300 sm:flex-row sm:items-center sm:justify-between">
      <span className="flex items-start gap-3">
        <Eye className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden />
        <span>
          <span className="block text-base font-semibold text-ink-900">{t("engagementPages.ui.buildFirstTitle")}</span>
          <span className="mt-0.5 block text-sm text-ink-600">{t("engagementPages.ui.buildFirstText")}</span>
        </span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-emerald-800">
        {t("engagementPages.ui.buildFirstCta")} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}
