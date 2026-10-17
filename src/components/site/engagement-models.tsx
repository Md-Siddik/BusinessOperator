import Link from "next/link";
import { ArrowRight, Check, ClipboardCheck, Handshake, Info, RefreshCw, type LucideIcon } from "lucide-react";
import { localizedPath } from "@/config/languages";
import { ENGAGEMENT_MODELS } from "@/config/engagement";
import type { Translator } from "@/lib/i18n/translator";
import { SectionHeading } from "./sections";

export const ENGAGEMENT_ICONS: Record<string, LucideIcon> = { monthly: RefreshCw, growth: Handshake, project: ClipboardCheck };

type Model = (typeof ENGAGEMENT_MODELS)[number];
type CardProps = { model: Model; locale: string; t: Translator["t"]; list: Translator["list"] };

function PointList({ points, dark }: { points: string[]; dark?: boolean }) {
  return (
    <ul className="space-y-2.5">
      {points.map((p) => (
        <li key={p} className={dark ? "flex gap-3 text-[0.9375rem] leading-6 text-ink-100" : "flex gap-3 text-[0.9375rem] leading-6 text-ink-700"}>
          <span className="flex h-6 shrink-0 items-center" aria-hidden>
            <span className={dark ? "flex h-[18px] w-[18px] items-center justify-center rounded-full bg-signal-400/15 text-signal-300" : "flex h-[18px] w-[18px] items-center justify-center rounded-full bg-brand-50 text-brand-600"}>
              <Check className="h-3 w-3" strokeWidth={2.75} />
            </span>
          </span>
          <span className="min-w-0">{p}</span>
        </li>
      ))}
    </ul>
  );
}

/** Monthly and task-based: two ways of working, side by side — deliberately not price tiers. */
function ModelCard({ model, locale, t, list }: CardProps) {
  const k = `home.engagement.models.${model.key}`;
  const Icon = ENGAGEMENT_ICONS[model.key]!;
  const title = t(`${k}.title`);
  return (
    <article className="group flex flex-col rounded-3xl border border-ink-200 bg-white p-7 shadow-card transition-[transform,box-shadow,border-color] duration-200 motion-safe:hover:-translate-y-1 hover:border-brand-200 hover:shadow-lifted sm:p-8">
      <div className="flex items-center justify-between gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100" aria-hidden>
          <Icon className="h-6 w-6" strokeWidth={1.75} />
        </span>
        <span className="rounded-full border border-ink-200 bg-ink-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink-600">{t(`home.engagement.kinds.${model.key}`)}</span>
      </div>
      <h3 className="mt-6 text-xl font-semibold tracking-tight text-ink-900 lg:text-[1.375rem]">{title}</h3>
      <p className="mt-2.5 text-pretty text-[0.9375rem] leading-relaxed text-ink-600 sm:text-base">{t(`${k}.text`)}</p>
      <div className="my-6 h-px bg-ink-200" aria-hidden />
      <div className="flex-1">
        <PointList points={list<string>(`${k}.points`)} />
      </div>
      <Link
        href={localizedPath(locale, `/engagement/${model.slug}`)}
        className="group/cta mt-8 flex min-h-12 items-center justify-between gap-3 rounded-xl border border-ink-200 bg-white px-5 text-[0.9375rem] font-semibold text-ink-900 transition-colors duration-200 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
      >
        <span>
          {t("home.engagement.cta")} <span className="sr-only">: {title}</span>
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 transition-transform duration-200 ease-out motion-safe:group-hover/cta:translate-x-0.5" aria-hidden />
      </Link>
    </article>
  );
}

/** Two separate paths becoming one rising line: a long-term relationship, not a bigger plan. */
function GrowthTogetherArt() {
  return (
    <svg viewBox="0 0 320 170" className="h-auto w-full" aria-hidden>
      <defs>
        <linearGradient id="et-gp-rise" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#6189f8" />
          <stop offset="1" stopColor="#7fe3f2" />
        </linearGradient>
      </defs>
      <g fill="none" strokeLinecap="round">
        <path d="M8 40 C 70 40, 100 98, 150 104" stroke="rgb(255 255 255 / 0.28)" strokeWidth="2" strokeDasharray="2 7" />
        <path d="M8 150 C 70 150, 100 112, 150 104" stroke="rgb(255 255 255 / 0.28)" strokeWidth="2" strokeDasharray="2 7" />
        <path d="M150 104 C 205 98, 250 62, 312 16" stroke="url(#et-gp-rise)" strokeWidth="3.5" />
      </g>
      <circle cx="8" cy="40" r="5" fill="#94b1fd" />
      <circle cx="8" cy="150" r="5" fill="#94b1fd" />
      <circle cx="150" cy="104" r="7" fill="#0e1630" stroke="#7fe3f2" strokeWidth="2.5" />
      <circle cx="312" cy="16" r="5.5" fill="#7fe3f2" />
    </svg>
  );
}

/** Growth Partnership: a different kind of relationship, so it gets a different composition. */
function GrowthPartnershipCard({ model, locale, t, list }: CardProps) {
  const k = `home.engagement.models.${model.key}`;
  const title = t(`${k}.title`);
  return (
    <article className="relative isolate overflow-hidden rounded-3xl border border-brand-400/25 bg-night-900 p-7 text-white shadow-lifted sm:p-10">
      <div className="bg-grid-dark pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_70%)]" aria-hidden />
      <div className="pointer-events-none absolute -right-32 -top-40 -z-10 h-96 w-96 rounded-full bg-brand-600/30 blur-3xl" aria-hidden />
      <div className="grid gap-10 lg:grid-cols-[1.25fr_1fr] lg:items-center lg:gap-14">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-signal-300 ring-1 ring-white/15" aria-hidden>
              <Handshake className="h-6 w-6" strokeWidth={1.75} />
            </span>
            <span className="rounded-full border border-signal-400/35 bg-signal-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-signal-300">{t(`home.engagement.kinds.${model.key}`)}</span>
          </div>
          <p className="mt-6 text-sm font-medium text-brand-200">{t(`${k}.lead`)}</p>
          <h3 className="mt-1.5 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h3>
          <p className="mt-3 max-w-xl text-pretty leading-relaxed text-ink-300">{t(`${k}.text`)}</p>
          <p className="mt-5 flex max-w-xl gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm leading-relaxed text-ink-300">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-signal-400" aria-hidden />
            {t(`${k}.note`)}
          </p>
          <Link
            href={localizedPath(locale, `/engagement/${model.slug}`)}
            className="group/cta mt-8 inline-flex min-h-12 items-center gap-3 rounded-xl bg-white px-5 text-[0.9375rem] font-semibold text-night-950 transition-colors duration-200 hover:bg-brand-50"
          >
            <span>
              {t("home.engagement.cta")} <span className="sr-only">: {title}</span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 transition-transform duration-200 ease-out motion-safe:group-hover/cta:translate-x-0.5" aria-hidden />
          </Link>
        </div>
        <div className="space-y-8">
          <div className="mx-auto max-w-sm lg:max-w-none">
            <GrowthTogetherArt />
          </div>
          <PointList points={list<string>(`${k}.points`)} dark />
        </div>
      </div>
    </article>
  );
}

/** Homepage: the three ways to work together; each links to its detail page. */
export function EngagementModels({ locale, t, list }: { locale: string; t: Translator["t"]; list: Translator["list"] }) {
  const byKey = (key: Model["key"]) => ENGAGEMENT_MODELS.find((m) => m.key === key)!;
  return (
    <section className="py-20 sm:py-28">
      <div className="container-page">
        <SectionHeading eyebrow={t("home.engagement.eyebrow")} title={t("home.engagement.title")} subtitle={t("home.engagement.subtitle")} align="center" />
        <div className="mx-auto mt-12 grid max-w-6xl gap-5 md:grid-cols-2 md:gap-6">
          <ModelCard model={byKey("monthly")} locale={locale} t={t} list={list} />
          <ModelCard model={byKey("project")} locale={locale} t={t} list={list} />
        </div>
        <div className="mx-auto mt-5 max-w-6xl md:mt-6">
          <GrowthPartnershipCard model={byKey("growth")} locale={locale} t={t} list={list} />
        </div>
      </div>
    </section>
  );
}
