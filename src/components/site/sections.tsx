import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  Globe,
  Handshake,
  LayoutDashboard,
  LayoutTemplate,
  Magnet,
  Mail,
  MessageSquareText,
  MonitorSmartphone,
  MousePointerClick,
  RefreshCw,
  Repeat,
  Target,
  TrendingUp,
  Users,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { localizedPath } from "@/config/languages";
import { SERVICE_CATEGORIES } from "@/config/services";
import { siteConfig } from "@/config/site";
import { ButtonLink } from "@/components/ui/button";
import type { Translator } from "@/lib/i18n/translator";
import { cn } from "@/lib/utils";

export const CATEGORY_ICONS: Record<string, LucideIcon> = { Globe, RefreshCw, LayoutDashboard, TrendingUp, Users, Workflow };
export const PROCESS_STEPS = ["understand", "build", "operate", "improve", "scale"] as const;

type T = Translator["t"];
type Tone = "light" | "dark";

export function Eyebrow({ children, className, tone = "light" }: { children: ReactNode; className?: string; tone?: Tone }) {
  return <p className={cn("text-xs font-semibold uppercase tracking-[0.14em]", tone === "dark" ? "text-signal-300" : "text-brand-700", className)}>{children}</p>;
}

export function SectionHeading({ eyebrow, title, subtitle, align = "left", tone = "light", className }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; align?: "left" | "center"; tone?: Tone; className?: string }) {
  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center", className)}>
      {eyebrow && <Eyebrow tone={tone}>{eyebrow}</Eyebrow>}
      <h2 className={cn("mt-3 text-balance text-3xl font-semibold tracking-[-0.025em] sm:text-4xl", tone === "dark" ? "text-white" : "text-ink-900")}>{title}</h2>
      {subtitle && <p className={cn("mt-4 text-pretty text-base leading-relaxed sm:text-lg", tone === "dark" ? "text-ink-300" : "text-ink-600")}>{subtitle}</p>}
    </div>
  );
}

export function PageHero({ eyebrow, title, subtitle, children }: { eyebrow: ReactNode; title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <section className="relative overflow-hidden border-b border-ink-100">
      <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" aria-hidden />
      <div className="container-page relative py-16 sm:py-24">
        <div className="max-w-3xl animate-fade-up">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="mt-4 text-balance text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">{title}</h1>
          {subtitle && <p className="mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-ink-600">{subtitle}</p>}
          {children}
        </div>
      </div>
    </section>
  );
}

/* ───────────── Hero ───────────── */

/** The growth flow the hero visual walks through. Stages only — no metrics or fabricated activity. */
const FLOW: { key: string; icon: LucideIcon }[] = [
  { key: "website", icon: MonitorSmartphone },
  { key: "visitors", icon: Users },
  { key: "engagement", icon: MousePointerClick },
  { key: "leads", icon: MessageSquareText },
  { key: "customers", icon: Handshake },
  { key: "growth", icon: TrendingUp },
];

function GrowthFlowCard({ t }: { t: T }) {
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none" aria-hidden>
      <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.6)] backdrop-blur-sm sm:p-5">
        <div className="flex items-center justify-between gap-3 px-2 pb-3 pt-1">
          <div>
            <p className="text-sm font-semibold text-white">{t("home.board.title")}</p>
            <p className="text-xs text-ink-400">{t("home.board.status")}</p>
          </div>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-signal-400/10 text-signal-300 ring-1 ring-signal-400/25">
            <TrendingUp className="h-4 w-4" />
          </span>
        </div>
        <ol className="relative space-y-1">
          {/* The connecting path, with one soft pulse travelling down it. */}
          <div className="pointer-events-none absolute bottom-7 left-[1.875rem] top-7 w-px bg-gradient-to-b from-brand-400/50 via-white/10 to-signal-400/60">
            <span className="absolute -left-[3px] h-[7px] w-[7px] rounded-full bg-signal-300 opacity-0 shadow-[0_0_14px_3px_rgb(63_208_230/0.55)] motion-safe:animate-flow-y" />
          </div>
          {FLOW.map(({ key, icon: Icon }, i) => {
            const last = i === FLOW.length - 1;
            return (
              <li key={key} className="relative flex animate-fade-up items-center gap-3.5 rounded-xl px-3 py-2.5 transition-colors duration-200 hover:bg-white/[0.05]" style={{ animationDelay: `${150 + i * 90}ms` }}>
                <span className={cn("relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border", last ? "border-signal-400/40 bg-night-900 text-signal-300" : "border-white/10 bg-night-900 text-brand-300")}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-white">{t(`home.board.stages.${key}`)}</span>
                  <span className="block truncate text-xs text-ink-400">{t(`home.board.items.${key}`)}</span>
                </span>
                <span className="text-[11px] font-medium tabular-nums text-ink-500">0{i + 1}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

export function HomeHero({ locale, t }: { locale: string; t: T }) {
  return (
    <section className="relative isolate overflow-hidden bg-night-950 text-white">
      <div className="bg-grid-dark pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_top_left,black,transparent_75%)]" aria-hidden />
      <div className="pointer-events-none absolute -right-40 -top-48 -z-10 h-[38rem] w-[38rem] rounded-full bg-brand-600/25 blur-3xl" aria-hidden />
      <div className="container-page grid items-center gap-12 py-16 sm:py-20 lg:grid-cols-[1.12fr_1fr] lg:gap-16 lg:py-24">
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-brand-200">
            <span className="h-1.5 w-1.5 rounded-full bg-signal-400" aria-hidden />
            {t("home.hero.eyebrow")}
          </span>
          <h1 className="mt-6 text-balance text-[2.5rem] font-semibold leading-[1.04] tracking-[-0.035em] sm:text-6xl lg:text-[4.25rem]">
            {t("home.hero.titleStart")} <span className="bg-gradient-to-r from-brand-300 to-signal-300 bg-clip-text text-transparent">{t("home.hero.titleEnd")}</span>
          </h1>
          <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-ink-300">{t("home.hero.subtitle")}</p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <ButtonLink href={localizedPath(locale, "/contact")} size="lg" className="bg-brand-500 shadow-[0_10px_30px_-10px_rgb(61_102_240/0.8)] hover:bg-brand-400 active:bg-brand-600">
              {t("cta.letsWorkTogether")} <ArrowRight className="h-4 w-4" aria-hidden />
            </ButtonLink>
            <ButtonLink href={localizedPath(locale, "/services")} size="lg" variant="outline" className="border-white/20 bg-white/5 text-white shadow-none hover:border-white/30 hover:bg-white/10">
              {t("cta.exploreServices")}
            </ButtonLink>
          </div>
          <p className="mt-6 flex items-start gap-2 text-sm text-ink-400">
            <Repeat className="mt-0.5 h-4 w-4 shrink-0 text-signal-400" aria-hidden />
            {t("home.hero.note")}
          </p>
        </div>
        <GrowthFlowCard t={t} />
      </div>
    </section>
  );
}

/* ───────────── The problem ───────────── */

export function SplitSection({ t, list }: { t: T; list: Translator["list"] }) {
  return (
    <section className="py-20 sm:py-28">
      <div className="container-page">
        <SectionHeading eyebrow={t("home.split.eyebrow")} title={t("home.split.title")} subtitle={t("home.split.subtitle")} align="center" />
        <div className="relative mx-auto mt-14 grid max-w-5xl gap-4 md:grid-cols-[1fr_1.35fr] md:gap-6">
          <div className="rounded-3xl border border-ink-200 bg-ink-50 p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">{t("home.split.youTitle")}</p>
            <ul className="mt-5 grid gap-3">
              {list<string>("home.split.youItems").map((item) => (
                <li key={item} className="flex items-start gap-3 text-[15px] text-ink-600">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-200/70 text-ink-500" aria-hidden>
                    <X className="h-3 w-3" strokeWidth={2.5} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          {/* From one to the other: right on desktop, down on mobile. */}
          <span className="z-10 mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-ink-200 bg-white text-brand-600 shadow-card md:absolute md:left-[42.5%] md:top-1/2 md:mx-0 md:-translate-x-1/2 md:-translate-y-1/2" aria-hidden>
            <ArrowRight className="hidden h-4 w-4 md:block" />
            <ArrowDown className="h-4 w-4 md:hidden" />
          </span>
          <div className="relative overflow-hidden rounded-3xl bg-night-900 p-7 text-white shadow-lifted">
            <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-brand-600/30 blur-3xl" aria-hidden />
            <p className="relative text-xs font-semibold uppercase tracking-[0.14em] text-signal-300">{t("home.split.usTitle")}</p>
            <ul className="relative mt-5 grid gap-3 sm:grid-cols-2">
              {list<string>("home.split.usItems").map((item) => (
                <li key={item} className="flex items-start gap-3 text-[15px] text-ink-100">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-signal-400/15 text-signal-300" aria-hidden>
                    <Check className="h-3 w-3" strokeWidth={2.75} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────────── Build → Attract → Engage → Convert → Grow ───────────── */

const JOURNEY_ICONS: LucideIcon[] = [LayoutTemplate, Magnet, MousePointerClick, Target, TrendingUp];

export function GrowthJourney({ locale, t, list }: { locale: string; t: T; list: Translator["list"] }) {
  const steps = list<{ title: string; text: string }>("home.journey.steps");
  return (
    <section className="border-y border-ink-100 bg-[#f5f7fb] py-20 sm:py-28">
      <div className="container-page">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading eyebrow={t("home.journey.eyebrow")} title={t("home.journey.title")} subtitle={t("home.journey.subtitle")} />
          <Link href={localizedPath(locale, "/how-we-work")} className="group inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:text-brand-800">
            {t("nav.howWeWork")} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </div>
        <ol className="relative mt-14 grid lg:grid-cols-5 lg:gap-5">
          {/* Desktop: a connecting rail with a soft light travelling along it. Mobile: a vertical rail. */}
          <div className="pointer-events-none absolute left-[8%] right-[8%] top-[2.875rem] hidden h-px overflow-hidden bg-ink-200 lg:block" aria-hidden>
            <span className="absolute inset-y-0 -left-1/4 w-1/4 bg-gradient-to-r from-transparent via-brand-500 to-transparent motion-safe:animate-flow-x" />
          </div>
          <div className="pointer-events-none absolute bottom-10 left-[1.375rem] top-10 w-px bg-gradient-to-b from-brand-300 via-ink-200 to-signal-400 lg:hidden" aria-hidden />
          {steps.map((step, i) => {
            const Icon = JOURNEY_ICONS[i] ?? TrendingUp;
            return (
              <li
                key={step.title}
                className="group relative flex gap-4 pb-5 last:pb-0 lg:block lg:rounded-2xl lg:border lg:border-ink-200 lg:bg-white lg:p-6 lg:shadow-soft lg:transition-all lg:duration-200 lg:hover:-translate-y-1 lg:hover:border-brand-200 lg:hover:shadow-lifted"
              >
                <span className="relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-night-900 text-signal-300 ring-4 ring-[#f5f7fb] transition-colors duration-200 group-hover:bg-brand-600 group-hover:text-white lg:ring-white">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 rounded-2xl border border-ink-200 bg-white p-5 shadow-soft lg:mt-5 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
                  <p className="text-xs font-semibold tabular-nums text-brand-600">0{i + 1}</p>
                  <h3 className="mt-1 text-lg font-semibold tracking-tight text-ink-900">{step.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{step.text}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/* ───────────── Services, as the system around the website ───────────── */

/** Homepage order: the foundation first, then what builds on it. */
const PILLAR_ORDER = ["digitalFoundation", "growthVisibility", "digitalOperations", "businessSystems", "automationAi", "peopleRecruitment"];

export function ServicePillars({ locale, t, heading = true }: { locale: string; t: T; heading?: boolean }) {
  const categories = PILLAR_ORDER.map((key) => SERVICE_CATEGORIES.find((c) => c.key === key)!).filter(Boolean);
  const [foundation, ...rest] = categories;
  if (!foundation) return null;
  const FoundationIcon = CATEGORY_ICONS[foundation.icon] ?? Globe;
  return (
    <div>
      {heading && <SectionHeading eyebrow={t("home.pillars.eyebrow")} title={t("home.pillars.title")} subtitle={t("home.pillars.subtitle")} />}
      <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3", heading && "mt-12")}>
        {/* The foundation: the website itself. */}
        <Link
          href={localizedPath(locale, `/services/${foundation.slug}`)}
          className="group relative flex flex-col overflow-hidden rounded-3xl bg-night-900 p-7 text-white shadow-lifted transition-transform duration-200 hover:-translate-y-0.5 sm:col-span-2 sm:p-8"
        >
          <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-brand-600/30 blur-3xl" aria-hidden />
          <div className="relative flex items-center justify-between gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-signal-300 ring-1 ring-white/15">
              <FoundationIcon className="h-5 w-5" aria-hidden />
            </span>
            <span className="rounded-full border border-signal-400/30 bg-signal-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-signal-300">{t(`home.pillars.roles.${foundation.key}`)}</span>
          </div>
          <h3 className="relative mt-6 text-2xl font-semibold tracking-tight">{t(`services.categories.${foundation.key}.name`)}</h3>
          <p className="relative mt-1 text-sm font-medium text-brand-200">{t(`services.categories.${foundation.key}.tagline`)}</p>
          <ul className="relative mt-5 flex flex-wrap gap-2">
            {foundation.items.slice(0, 6).map((item) => (
              <li key={item} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-ink-200">
                {t(`serviceItems.${item}`)}
              </li>
            ))}
          </ul>
          <span className="relative mt-6 inline-flex items-center gap-1 text-sm font-semibold text-white">
            {t("cta.learnMore")} <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
          </span>
        </Link>

        {rest.map((c) => {
          const Icon = CATEGORY_ICONS[c.icon] ?? Globe;
          return (
            <Link
              key={c.slug}
              href={localizedPath(locale, `/services/${c.slug}`)}
              className="group relative flex flex-col rounded-3xl border border-ink-200 bg-white p-6 shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lifted"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100 transition-colors group-hover:bg-brand-600 group-hover:text-white group-hover:ring-brand-600">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-500">{t(`home.pillars.roles.${c.key}`)}</span>
              </div>
              <h3 className="mt-5 text-lg font-semibold tracking-tight text-ink-900">{t(`services.categories.${c.key}.name`)}</h3>
              <p className="mt-1.5 flex-1 text-sm leading-relaxed text-ink-600">{t(`services.categories.${c.key}.tagline`)}</p>
              <span className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-ink-800 group-hover:text-brand-700">
                {t("cta.learnMore")} <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
              </span>
            </Link>
          );
        })}

        <Link
          href={localizedPath(locale, "/services")}
          className="group flex flex-col justify-between gap-6 rounded-3xl border border-brand-100 bg-brand-50/70 p-6 transition-colors duration-200 hover:border-brand-200 hover:bg-brand-50 sm:col-span-2 sm:flex-row sm:items-center"
        >
          <p className="max-w-md text-sm leading-relaxed text-ink-700">{t("meta.pages.services.description")}</p>
          <span className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-brand-700">
            {t("cta.exploreOurServices")} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </Link>
      </div>
    </div>
  );
}

/* ───────────── Company process (service and how-we-work pages) ───────────── */

export function ProcessSteps({ t, detailed = false }: { t: T; detailed?: boolean }) {
  return (
    <ol className="relative grid gap-4 md:grid-cols-5">
      <div className="pointer-events-none absolute left-0 right-0 top-6 hidden h-px bg-gradient-to-r from-transparent via-ink-200 to-transparent md:block" aria-hidden />
      {PROCESS_STEPS.map((step, i) => (
        <li key={step} className="relative rounded-2xl border border-ink-200 bg-white p-5 shadow-soft">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-brand-200 bg-brand-50 text-sm font-semibold tabular-nums text-brand-700">0{i + 1}</span>
          <h3 className="mt-4 text-base font-semibold text-ink-900">{t(`process.${step}.title`)}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{detailed ? t(`howWeWork.details.${step}`) : t(`process.${step}.text`)}</p>
        </li>
      ))}
    </ol>
  );
}

/* ───────────── Long-term partner ───────────── */

export function MoreThanWebsite({ locale, t, list }: { locale: string; t: T; list: Translator["list"] }) {
  const cycle = list<string>("home.moreThan.cycle");
  return (
    <section className="relative isolate overflow-hidden bg-night-950 py-20 text-white sm:py-28">
      <div className="bg-grid-dark pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_bottom_right,black,transparent_70%)]" aria-hidden />
      <div className="pointer-events-none absolute -bottom-48 -left-40 -z-10 h-[30rem] w-[30rem] rounded-full bg-brand-600/20 blur-3xl" aria-hidden />
      <div className="container-page grid gap-12 lg:grid-cols-[1fr_1.15fr] lg:items-center">
        <div>
          <SectionHeading tone="dark" eyebrow={t("home.moreThan.eyebrow")} title={t("home.moreThan.title")} subtitle={t("home.moreThan.subtitle")} />
          {cycle.length > 0 && (
            <ol className="mt-8 flex flex-wrap items-center gap-2" aria-label={cycle.join(" → ")}>
              {cycle.map((stage, i) => (
                <li key={stage} className="flex items-center gap-2">
                  <span className={cn("rounded-full border px-3.5 py-1.5 text-sm font-medium", i === cycle.length - 1 ? "border-signal-400/40 bg-signal-400/10 text-signal-200" : "border-white/15 bg-white/5 text-ink-100")}>{stage}</span>
                  {i < cycle.length - 1 ? <ArrowRight className="h-3.5 w-3.5 text-ink-500" aria-hidden /> : <Repeat className="h-4 w-4 text-signal-400" aria-hidden />}
                </li>
              ))}
            </ol>
          )}
          <ButtonLink href={localizedPath(locale, "/contact")} className="mt-9 bg-brand-500 hover:bg-brand-400" size="lg">
            {t("cta.talkToTeam")} <ArrowRight className="h-4 w-4" aria-hidden />
          </ButtonLink>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {list<string>("home.moreThan.items").map((item) => {
            const [question, answer] = item.split("?");
            return (
              <li key={item} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition-colors duration-200 hover:border-white/20 hover:bg-white/[0.07]">
                <p className="text-sm text-ink-400">{question}?</p>
                <p className="mt-1 text-base font-semibold text-white">{answer?.trim()}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/* ───────────── Closing call to action (all public pages) ───────────── */

export function CtaBand({ locale, t, title, subtitle }: { locale: string; t: T; title?: string; subtitle?: string }) {
  return (
    <section className="py-16 sm:py-24">
      <div className="container-page">
        <div className="relative isolate overflow-hidden rounded-3xl bg-night-900 px-6 py-14 text-center shadow-lifted sm:px-12 sm:py-20">
          <div className="bg-grid-dark pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" aria-hidden />
          <div className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-80 w-[40rem] -translate-x-1/2 rounded-full bg-brand-600/35 blur-3xl" aria-hidden />
          <h2 className="mx-auto max-w-2xl text-balance text-3xl font-semibold tracking-[-0.025em] text-white sm:text-4xl">{title ?? t("home.finalCta.title")}</h2>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-ink-300">{subtitle ?? t("home.finalCta.subtitle")}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <ButtonLink href={localizedPath(locale, "/contact")} size="lg" className="bg-white text-night-950 hover:bg-brand-50">
              {t("cta.letsWorkTogether")} <ArrowRight className="h-4 w-4" aria-hidden />
            </ButtonLink>
            <ButtonLink href={localizedPath(locale, "/services")} size="lg" variant="ghost" className="text-white hover:bg-white/10 hover:text-white">
              {t("cta.exploreOurServices")}
            </ButtonLink>
          </div>
          <a href={`mailto:${siteConfig.contact.email}`} className="mt-7 inline-flex items-center gap-2 text-sm text-ink-400 transition-colors hover:text-white">
            <Mail className="h-4 w-4" aria-hidden /> {siteConfig.contact.email}
          </a>
        </div>
      </div>
    </section>
  );
}
