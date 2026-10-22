import Link from "next/link";
import { ArrowDown, ArrowRight, Check, Handshake, Layers, MessageSquareText } from "lucide-react";
import { localizedPath } from "@/config/languages";
import type { Translator } from "@/lib/i18n/translator";
import { ButtonLink } from "@/components/ui/button";
import { Eyebrow } from "./sections";

type T = Translator["t"];

/**
 * "You run the business. We run the digital side." — the partner proposition, right after the hero.
 * The visual splits responsibility: the client keeps the business, we take the digital side as ONE
 * offering. Deliberately no service list here (it reads as "they do everything"); the individual
 * services stay on the services pages, driven by Service Management.
 */
export function DigitalSideSection({ locale, t, list }: { locale: string; t: T; list: Translator["list"] }) {
  const yours = list<string>("home.digitalSide.youItems");
  const points = list<string>("home.digitalSide.servicePoints");
  return (
    <section className="relative isolate overflow-hidden py-20 sm:py-28" aria-labelledby="digital-side-title">
      <div className="bg-grid pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_70%)]" aria-hidden />
      <div className="container-page grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-16">
        <div className="max-w-[38rem]">
          <Eyebrow>{t("home.digitalSide.eyebrow")}</Eyebrow>
          <h2 id="digital-side-title" className="mt-4 text-balance text-[2.25rem] font-semibold leading-[1.06] tracking-[-0.03em] text-ink-900 sm:text-5xl lg:text-[2.85rem] xl:text-[3.1rem]">
            <span className="block">{t("home.digitalSide.titleBusiness")}</span> <span className="mt-1 block text-brand-600">{t("home.digitalSide.titleDigital")}</span>
          </h2>
          <p className="mt-6 text-pretty text-lg leading-relaxed text-ink-600">{t("home.digitalSide.subtitle")}</p>
          <p className="mt-5 border-l-2 border-brand-200 pl-4 text-[15px] leading-relaxed text-ink-700">{t("home.digitalSide.responsibility")}</p>
          <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
            <ButtonLink href={localizedPath(locale, "/contact")} size="lg">
              {t("cta.letsWorkTogether")} <ArrowRight className="h-4 w-4" aria-hidden />
            </ButtonLink>
            <Link href={localizedPath(locale, "/services")} className="group inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:text-brand-800">
              {t("cta.exploreServices")} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
          {/* Your side: the business itself. */}
          <div className="rounded-3xl border border-ink-200 bg-white p-5 shadow-card sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-base font-semibold text-ink-900">{t("home.digitalSide.youTitle")}</p>
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-500">{t("home.digitalSide.youLabel")}</span>
            </div>
            <ul className="mt-4 flex flex-wrap gap-2">
              {yours.map((item) => (
                <li key={item} className="rounded-full border border-ink-200 bg-ink-50 px-3 py-1 text-sm text-ink-700">
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* The handover between the two sides. */}
          <div className="relative flex justify-center py-3" aria-hidden>
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-gradient-to-b from-ink-200 to-brand-300" />
            <span className="relative inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-ink-700 shadow-soft">
              <Handshake className="h-3.5 w-3.5 text-brand-600" />
              {t("home.digitalSide.handoff")}
              <ArrowDown className="h-3.5 w-3.5 text-ink-400" />
            </span>
          </div>

          {/* Our side: one offering, written broadly enough that each visitor sees their own need in it. */}
          <div className="relative overflow-hidden rounded-3xl bg-night-900 p-6 text-white shadow-lifted sm:p-8">
            <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-brand-600/30 blur-3xl" aria-hidden />
            <div className="relative flex items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/[0.06] text-signal-300 ring-1 ring-white/15" aria-hidden>
                <Layers className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-signal-300">{t("home.digitalSide.usLabel")}</p>
                <h3 className="mt-1 text-balance text-2xl font-semibold tracking-tight sm:text-[1.75rem]">{t("home.digitalSide.serviceTitle")}</h3>
              </div>
            </div>
            <p className="relative mt-5 text-pretty text-[15px] leading-relaxed text-ink-200 sm:text-base">{t("home.digitalSide.serviceText")}</p>
            <ul className="relative mt-6 grid gap-3 border-t border-white/10 pt-6">
              {points.map((point) => (
                <li key={point} className="flex items-start gap-3 text-sm text-ink-100">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-signal-400/15 text-signal-300" aria-hidden>
                    <Check className="h-3 w-3" strokeWidth={2.75} />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
            <p className="relative mt-6 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3.5 text-sm leading-relaxed text-ink-100">
              <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" aria-hidden />
              {t("home.digitalSide.serviceFooter")}
            </p>
          </div>
          <p className="mt-3 text-center text-xs text-ink-500">{t("home.digitalSide.scopeNote")}</p>
        </div>
      </div>
    </section>
  );
}
