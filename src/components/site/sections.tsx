import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Check, Globe, LayoutDashboard, RefreshCw, TrendingUp, Users, Workflow, type LucideIcon } from "lucide-react";
import { localizedPath } from "@/config/languages";
import { SERVICE_CATEGORIES } from "@/config/services";
import { ButtonLink } from "@/components/ui/button";
import type { Translator } from "@/lib/i18n/translator";
import { cn } from "@/lib/utils";

export const CATEGORY_ICONS: Record<string, LucideIcon> = { Globe, RefreshCw, LayoutDashboard, TrendingUp, Users, Workflow };
export const PROCESS_STEPS = ["understand", "build", "operate", "improve", "scale"] as const;

type T = Translator["t"];

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-xs font-semibold uppercase tracking-[0.14em] text-brand-700", className)}>{children}</p>;
}

export function SectionHeading({ eyebrow, title, subtitle, align = "left", className }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; align?: "left" | "center"; className?: string }) {
  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center", className)}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">{title}</h2>
      {subtitle && <p className="mt-4 text-pretty text-base leading-relaxed text-ink-600 sm:text-lg">{subtitle}</p>}
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

const BOARD_ITEMS = [
  { key: "website", done: true },
  { key: "seo", done: true },
  { key: "email", done: true },
  { key: "crm", done: false },
  { key: "hiring", done: false },
  { key: "automation", done: true },
] as const;

export function HomeHero({ locale, t }: { locale: string; t: T }) {
  return (
    <section className="relative overflow-hidden">
      <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" aria-hidden />
      <div className="pointer-events-none absolute -top-40 right-[-10%] h-[36rem] w-[36rem] rounded-full bg-brand-100/60 blur-3xl" aria-hidden />
      <div className="container-page relative grid items-center gap-14 py-16 sm:py-24 lg:grid-cols-[1.15fr_1fr] lg:py-28">
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-brand-700 shadow-soft">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden />
            {t("home.hero.eyebrow")}
          </span>
          <h1 className="mt-6 text-balance text-[2.6rem] font-semibold leading-[1.05] tracking-tight text-ink-900 sm:text-6xl lg:text-[4.1rem]">
            {t("home.hero.titleStart")}
            <span className="block font-serif font-normal italic text-brand-700">{t("home.hero.titleEnd")}</span>
          </h1>
          <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-ink-600">{t("home.hero.subtitle")}</p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <ButtonLink href={localizedPath(locale, "/contact")} size="lg">
              {t("cta.letsWorkTogether")} <ArrowRight className="h-4 w-4" aria-hidden />
            </ButtonLink>
            <ButtonLink href={localizedPath(locale, "/services")} size="lg" variant="outline">
              {t("cta.exploreServices")}
            </ButtonLink>
          </div>
          <p className="mt-6 text-sm text-ink-500">{t("home.hero.note")}</p>
        </div>

        <div className="relative mx-auto w-full max-w-md lg:max-w-none" aria-hidden>
          <div className="animate-float rounded-3xl border border-ink-200/80 bg-white p-5 shadow-lifted sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-ink-900">{t("home.board.title")}</p>
                <p className="text-xs text-ink-500">{t("home.board.status")}</p>
              </div>
              <div className="flex -space-x-2">
                {["bg-brand-500", "bg-emerald-500", "bg-amber-400"].map((c) => (
                  <span key={c} className={cn("h-7 w-7 rounded-full border-2 border-white", c)} />
                ))}
              </div>
            </div>
            <ul className="mt-5 space-y-2.5">
              {BOARD_ITEMS.map((item, i) => (
                <li key={item.key} className="flex animate-fade-up items-center justify-between gap-3 rounded-xl border border-ink-100 bg-ink-50/60 px-3.5 py-3" style={{ animationDelay: `${200 + i * 120}ms` }}>
                  <span className="flex items-center gap-3 text-sm text-ink-800">
                    <span className={cn("flex h-6 w-6 items-center justify-center rounded-full", item.done ? "bg-emerald-100 text-emerald-700" : "bg-brand-100 text-brand-700")}>
                      {item.done ? <Check className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    </span>
                    {t(`home.board.items.${item.key}`)}
                  </span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", item.done ? "bg-emerald-50 text-emerald-700" : "bg-brand-50 text-brand-700")}>
                    {item.done ? t("home.board.done") : t("home.board.inProgress")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="absolute -bottom-6 -left-6 -z-10 h-40 w-40 rounded-3xl bg-brand-200/50 blur-2xl" />
        </div>
      </div>
    </section>
  );
}

export function SplitSection({ t, list }: { t: T; list: Translator["list"] }) {
  return (
    <section className="border-y border-ink-100 bg-ink-50/50 py-20 sm:py-28">
      <div className="container-page">
        <SectionHeading eyebrow={t("home.split.eyebrow")} title={t("home.split.title")} subtitle={t("home.split.subtitle")} align="center" />
        <div className="mx-auto mt-14 grid max-w-5xl gap-5 md:grid-cols-[1fr_1.35fr]">
          <div className="rounded-3xl border border-ink-200 bg-white p-7 shadow-card">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">{t("home.split.youTitle")}</p>
            <ul className="mt-5 grid gap-2.5">
              {list<string>("home.split.youItems").map((item) => (
                <li key={item} className="flex items-center gap-3 text-[15px] text-ink-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-ink-300" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative overflow-hidden rounded-3xl bg-brand-950 p-7 text-white shadow-lifted">
            <div className="pointer-events-none absolute inset-0 opacity-40 [background:radial-gradient(30rem_18rem_at_100%_0%,#3d66f0,transparent)]" aria-hidden />
            <p className="relative text-xs font-semibold uppercase tracking-[0.14em] text-brand-200">{t("home.split.usTitle")}</p>
            <ul className="relative mt-5 grid gap-2.5 sm:grid-cols-2">
              {list<string>("home.split.usItems").map((item) => (
                <li key={item} className="flex items-center gap-3 text-[15px] text-brand-50">
                  <Check className="h-4 w-4 shrink-0 text-brand-300" aria-hidden />
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

export function ServicePillars({ locale, t, heading = true }: { locale: string; t: T; heading?: boolean }) {
  return (
    <div>
      {heading && <SectionHeading eyebrow={t("home.pillars.eyebrow")} title={t("home.pillars.title")} subtitle={t("home.pillars.subtitle")} />}
      <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3", heading && "mt-12")}>
        {SERVICE_CATEGORIES.map((c, i) => {
          const Icon = CATEGORY_ICONS[c.icon] ?? Globe;
          return (
            <Link
              key={c.slug}
              href={localizedPath(locale, `/services/${c.slug}`)}
              className="group relative flex flex-col rounded-2xl border border-ink-200 bg-white p-6 shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lifted"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="text-xs font-medium tabular-nums text-ink-400">0{i + 1}</span>
              </div>
              <h3 className="mt-5 text-lg font-semibold tracking-tight text-ink-900">{t(`services.categories.${c.key}.name`)}</h3>
              <p className="mt-1 text-sm font-medium text-brand-700">{t(`services.categories.${c.key}.tagline`)}</p>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-ink-600">{t(`services.categories.${c.key}.summary`)}</p>
              <span className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-ink-800 group-hover:text-brand-700">
                {t("cta.learnMore")} <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function ProcessSteps({ t, detailed = false }: { t: T; detailed?: boolean }) {
  return (
    <ol className="relative grid gap-4 md:grid-cols-5">
      <div className="pointer-events-none absolute left-0 right-0 top-6 hidden h-px bg-gradient-to-r from-transparent via-ink-200 to-transparent md:block" aria-hidden />
      {PROCESS_STEPS.map((step, i) => (
        <li key={step} className="relative rounded-2xl border border-ink-200 bg-white p-5 shadow-soft">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-brand-200 bg-brand-50 font-serif text-lg italic text-brand-700">0{i + 1}</span>
          <h3 className="mt-4 text-base font-semibold text-ink-900">{t(`process.${step}.title`)}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{detailed ? t(`howWeWork.details.${step}`) : t(`process.${step}.text`)}</p>
        </li>
      ))}
    </ol>
  );
}

export function MoreThanWebsite({ locale, t, list }: { locale: string; t: T; list: Translator["list"] }) {
  return (
    <section className="py-20 sm:py-28">
      <div className="container-page grid gap-12 lg:grid-cols-[1fr_1.3fr] lg:items-center">
        <div>
          <SectionHeading eyebrow={t("home.moreThan.eyebrow")} title={t("home.moreThan.title")} subtitle={t("home.moreThan.subtitle")} />
          <ButtonLink href={localizedPath(locale, "/contact")} className="mt-8" size="lg">
            {t("cta.talkToTeam")} <ArrowRight className="h-4 w-4" aria-hidden />
          </ButtonLink>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {list<string>("home.moreThan.items").map((item) => {
            const [question, answer] = item.split("?");
            return (
              <li key={item} className="rounded-2xl border border-ink-200 bg-white p-5 shadow-soft">
                <p className="text-sm text-ink-500">{question}?</p>
                <p className="mt-1 text-base font-semibold text-ink-900">{answer?.trim()}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

export function CtaBand({ locale, t, title, subtitle }: { locale: string; t: T; title?: string; subtitle?: string }) {
  return (
    <section className="py-16 sm:py-24">
      <div className="container-page">
        <div className="relative overflow-hidden rounded-3xl bg-brand-950 px-6 py-14 text-center shadow-lifted sm:px-12 sm:py-16">
          <div className="pointer-events-none absolute inset-0 opacity-50 [background:radial-gradient(40rem_20rem_at_50%_-20%,#3d66f0,transparent)]" aria-hidden />
          <h2 className="relative mx-auto max-w-2xl text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">{title ?? t("home.finalCta.title")}</h2>
          <p className="relative mx-auto mt-4 max-w-xl text-pretty text-brand-100/80">{subtitle ?? t("home.finalCta.subtitle")}</p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <ButtonLink href={localizedPath(locale, "/contact")} size="lg" className="bg-white text-ink-900 hover:bg-brand-50">
              {t("cta.letsWorkTogether")} <ArrowRight className="h-4 w-4" aria-hidden />
            </ButtonLink>
            <ButtonLink href={localizedPath(locale, "/services")} size="lg" variant="ghost" className="text-white hover:bg-white/10 hover:text-white">
              {t("cta.exploreOurServices")}
            </ButtonLink>
          </div>
        </div>
      </div>
    </section>
  );
}
