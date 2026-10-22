import Link from "next/link";
import { ArrowRight, ArrowUpRight, Globe, MessageSquareText, Repeat, Workflow, type LucideIcon } from "lucide-react";
import { localizedPath } from "@/config/languages";
import type { ServiceView } from "@/features/service-catalog/view";
import type { Translator } from "@/lib/i18n/translator";
import { cn } from "@/lib/utils";
import { Eyebrow } from "./sections";
import { servicePrice } from "./service-landing";

type T = Translator["t"];
type Layer = { title: string; text: string };

const LAYER_ICONS: LucideIcon[] = [Globe, MessageSquareText, Workflow, Repeat];

/**
 * One outcome, not a catalogue: the digital side as one infrastructure in four layers, so every
 * visitor can see their own need in it. Starting points are the Owner's *Featured* services from
 * Service Management (names, prices, discounts and links are never duplicated here).
 */
export function InfrastructureSection({ locale, t, list, featured }: { locale: string; t: T; list: Translator["list"]; featured: ServiceView[] }) {
  const layers = list<Layer>("home.infrastructure.layers");
  return (
    <section data-tone="dark" className="bg-mist py-24 sm:py-32" aria-labelledby="infrastructure-title">
      <div className="container-page">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <Eyebrow>{t("home.infrastructure.eyebrow")}</Eyebrow>
            <h2 id="infrastructure-title" className="mt-5 text-balance text-[2rem] font-semibold leading-[1.1] tracking-[-0.03em] text-ink-900 sm:text-[2.5rem]">
              {t("home.infrastructure.title")}
            </h2>
            <p className="mt-6 text-pretty text-lg leading-relaxed text-ink-600">{t("home.infrastructure.subtitle")}</p>
            <p className="mt-8 text-[15px] font-medium leading-relaxed text-ink-800">{t("home.infrastructure.closing")}</p>
          </div>

          {/* The layers, stacked like the infrastructure they describe. */}
          <ol className="relative lg:col-span-7">
            <div className="pointer-events-none absolute bottom-8 left-[1.6875rem] top-8 w-px bg-gradient-to-b from-brand-400 via-ink-200 to-signal-400 sm:left-[2.1875rem]" aria-hidden />
            {layers.map((layer, i) => {
              const Icon = LAYER_ICONS[i] ?? Globe;
              return (
                <li key={layer.title} className="relative flex gap-4 py-3 motion-safe:animate-fade-up sm:gap-6 sm:px-2" style={{ animationDelay: `${i * 80}ms` }}>
                  <span className="relative z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-ink-200 bg-white text-brand-600 shadow-soft" aria-hidden>
                    <Icon className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <div className={cn("min-w-0 flex-1 pb-5 pt-1", i < layers.length - 1 && "border-b border-ink-200")}>
                    <div className="flex items-baseline gap-3">
                      <span className="text-xs font-semibold tabular-nums text-ink-400">0{i + 1}</span>
                      <h3 className="text-lg font-semibold tracking-tight text-ink-900">{layer.title}</h3>
                    </div>
                    <p className="mt-1.5 text-pretty text-[15px] leading-relaxed text-ink-600">{layer.text}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        {featured.length > 0 && (
          <div className="mt-20">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink-200 pb-5">
              <div className="max-w-xl">
                <h3 className="text-lg font-semibold tracking-tight text-ink-900">{t("home.infrastructure.startTitle")}</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-600">{t("home.infrastructure.startText")}</p>
              </div>
              <Link href={localizedPath(locale, "/services")} className="group inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:text-brand-800">
                {t("homeV2.services.all")} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </div>
            <ul className="grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
              {featured.map((s) => {
                const price = servicePrice(s, t, locale);
                return (
                  <li key={s.slug} className="border-b border-ink-200">
                    <Link href={localizedPath(locale, `/services/${s.slug}`)} className="group flex h-full flex-col py-6">
                      <span className="flex items-start justify-between gap-3">
                        <span className="font-semibold tracking-tight text-ink-900 group-hover:text-brand-700">{s.shortTitle || s.name}</span>
                        <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-700" aria-hidden />
                      </span>
                      <span className="mt-1.5 flex-1 text-sm leading-relaxed text-ink-600">{s.shortDescription}</span>
                      {price.hasPrice && (
                        <span className="mt-3 text-sm text-ink-800">
                          {price.text}
                          {price.discountLabel && <span className="ml-2 rounded-md bg-brand-50 px-1.5 py-0.5 text-xs font-medium text-brand-700">{price.discountLabel}</span>}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
