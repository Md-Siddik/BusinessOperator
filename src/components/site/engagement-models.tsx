import Link from "next/link";
import { ArrowRight, Check, ClipboardCheck, Handshake, RefreshCw, type LucideIcon } from "lucide-react";
import { localizedPath } from "@/config/languages";
import { ENGAGEMENT_MODELS } from "@/config/engagement";
import type { Translator } from "@/lib/i18n/translator";
import { cn } from "@/lib/utils";
import { SectionHeading } from "./sections";

export const ENGAGEMENT_ICONS: Record<string, LucideIcon> = { monthly: RefreshCw, growth: Handshake, project: ClipboardCheck };

/** Deep navy for the featured card, with a restrained blue wash in the top-right corner (kept clear of the text). */
const FEATURED_BG = "#142448";
const FEATURED_GLOW = "radial-gradient(circle 280px at 100% 0%, rgb(49 85 245 / 0.3), rgb(49 85 245 / 0))";

type EngagementCardProps = {
  icon: LucideIcon;
  title: string;
  text: string;
  points: string[];
  href: string;
  cta: string;
  variant?: "default" | "featured";
  className?: string;
};

/**
 * One engagement model. Uses `grid-rows-subgrid` so the icon, title, description, divider, feature list and CTA
 * rows line up across sibling cards in the same row, keeping every CTA on a shared baseline.
 */
function EngagementCard({ icon: Icon, title, text, points, href, cta, variant = "default", className }: EngagementCardProps) {
  const featured = variant === "featured";
  return (
    <article
      className={cn(
        "row-span-6 grid grid-rows-subgrid gap-0 rounded-[20px] border p-6 transition-[transform,box-shadow,border-color] duration-200 ease-out motion-safe:hover:-translate-y-1 sm:p-7 xl:p-8",
        featured
          ? "border-white/10 text-white shadow-card hover:border-white/20 hover:shadow-lifted"
          : "border-ink-200 bg-white shadow-card hover:border-ink-300 hover:shadow-lifted",
        className,
      )}
      style={featured ? { backgroundColor: FEATURED_BG, backgroundImage: FEATURED_GLOW } : undefined}
    >
      <span
        className={cn(
          "flex h-13 w-13 items-center justify-center rounded-[14px] ring-1",
          featured ? "bg-white/10 text-brand-200 ring-white/15" : "bg-brand-50 text-brand-600 ring-brand-100",
        )}
        aria-hidden
      >
        <Icon className="h-6 w-6" strokeWidth={1.75} />
      </span>

      <h3 className={cn("mt-6 text-xl font-semibold tracking-tight lg:text-[1.3125rem]", featured ? "text-white" : "text-ink-900")}>{title}</h3>

      <p className={cn("mt-2.5 text-pretty text-[0.9375rem] leading-[1.6] sm:text-base", featured ? "text-white/80" : "text-ink-600")}>{text}</p>

      <div className={cn("my-6 h-px", featured ? "bg-white/15" : "bg-ink-200")} aria-hidden />

      <ul className="space-y-3 self-start">
        {points.map((p) => (
          <li key={p} className={cn("flex gap-3 text-[0.9375rem] leading-[1.6] sm:text-base", featured ? "text-white/90" : "text-ink-700")}>
            {/* Fixed-height box equal to one line of text keeps the check on the first line when the text wraps. */}
            <span className="flex h-6 shrink-0 items-center" aria-hidden>
              <span className={cn("flex h-[18px] w-[18px] items-center justify-center rounded-full", featured ? "bg-white/15 text-white" : "bg-brand-50 text-brand-600")}>
                <Check className="h-3 w-3" strokeWidth={2.75} />
              </span>
            </span>
            <span className="min-w-0">{p}</span>
          </li>
        ))}
      </ul>

      <Link
        href={href}
        className={cn(
          "group/cta mt-8 flex min-h-12 items-center justify-between gap-3 self-end rounded-xl px-5 text-[0.9375rem] font-semibold transition-colors duration-200",
          featured
            ? "bg-white hover:bg-brand-50"
            : "border border-ink-200 bg-white text-ink-900 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700",
        )}
        style={featured ? { color: FEATURED_BG } : undefined}
      >
        <span>
          {cta} <span className="sr-only">: {title}</span>
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 transition-transform duration-200 ease-out motion-safe:group-hover/cta:translate-x-0.5" aria-hidden />
      </Link>
    </article>
  );
}

/** Homepage overview of the three engagement models; each card links to its detail page. */
export function EngagementModels({ locale, t, list }: { locale: string; t: Translator["t"]; list: Translator["list"] }) {
  return (
    <section className="border-y border-ink-100 bg-[#f8fafc] py-20 sm:py-28">
      <div className="container-page">
        <SectionHeading eyebrow={t("home.engagement.eyebrow")} title={t("home.engagement.title")} subtitle={t("home.engagement.subtitle")} align="center" />
        {/* 1 col → 2 cols (third card centred at the same width, via a 4-track grid) → 3 equal cols. */}
        <div className="mt-12 grid gap-5 md:grid-cols-4 md:gap-6 lg:grid-cols-3">
          {ENGAGEMENT_MODELS.map((m, i) => {
            const k = `home.engagement.models.${m.key}`;
            return (
              <EngagementCard
                key={m.key}
                icon={ENGAGEMENT_ICONS[m.key]!}
                title={t(`${k}.title`)}
                text={t(`${k}.text`)}
                points={list<string>(`${k}.points`)}
                href={localizedPath(locale, `/engagement/${m.slug}`)}
                cta={t("home.engagement.cta")}
                variant={m.key === "growth" ? "featured" : "default"}
                className={cn("md:col-span-2 lg:col-span-1", i === 2 && "md:col-start-2 lg:col-start-auto")}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
