import { Check, Handshake } from "lucide-react";
import type { Translator } from "@/lib/i18n/translator";
import { Eyebrow } from "./sections";

type T = Translator["t"];

/**
 * "You run the business. We run the digital side." — the operating model, right after the hero.
 * Deliberately NOT a second hero: section-scale heading, no buttons, an editorial two-column
 * ledger of who looks after what. The headline wording is fixed (tested).
 */
export function DigitalSideSection({ t, list }: { t: T; list: Translator["list"] }) {
  const yours = list<string>("home.digitalSide.youItems");
  const ours = list<string>("home.digitalSide.usItems");
  const points = list<string>("home.digitalSide.servicePoints");
  return (
    <section data-tone="light" className="py-24 sm:py-32" aria-labelledby="digital-side-title">
      <div className="container-page grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-5 lg:pt-2">
          <Eyebrow>{t("home.digitalSide.eyebrow")}</Eyebrow>
          <h2 id="digital-side-title" className="mt-5 text-balance text-[2rem] font-semibold leading-[1.1] tracking-[-0.03em] text-ink-900 sm:text-[2.5rem]">
            <span className="block">{t("home.digitalSide.titleBusiness")}</span> <span className="block text-brand-600">{t("home.digitalSide.titleDigital")}</span>
          </h2>
          <p className="mt-6 text-pretty text-lg leading-relaxed text-ink-600">{t("home.digitalSide.subtitle")}</p>
          <p className="mt-6 border-l-2 border-brand-500 pl-4 text-[15px] font-medium leading-relaxed text-ink-800">{t("home.digitalSide.responsibility")}</p>
        </div>

        {/* The operating model: who looks after what. */}
        <div className="lg:col-span-7">
          <div className="grid overflow-hidden rounded-3xl border border-ink-200 motion-safe:animate-fade-up md:grid-cols-2">
            <div className="bg-white p-6 sm:p-8">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">{t("home.digitalSide.youLabel")}</p>
              <h3 className="mt-1.5 text-lg font-semibold tracking-tight text-ink-900">{t("home.digitalSide.youTitle")}</h3>
              <ul className="mt-6 divide-y divide-ink-100 border-t border-ink-100">
                {yours.map((item) => (
                  <li key={item} className="flex items-center gap-3 py-3 text-[15px] text-ink-700">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink-300" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-brand-950 p-6 text-white sm:p-8">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-signal-300">{t("home.digitalSide.usLabel")}</p>
              <h3 className="mt-1.5 text-lg font-semibold tracking-tight">{t("home.digitalSide.usTitle")}</h3>
              <ul className="mt-6 divide-y divide-white/10 border-t border-white/10">
                {ours.map((item) => (
                  <li key={item} className="flex items-center gap-3 py-3 text-[15px] text-ink-100">
                    <Check className="h-4 w-4 shrink-0 text-signal-300" strokeWidth={2.5} aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            {/* How the two sides connect. */}
            <div className="flex flex-col gap-4 border-t border-ink-200 bg-ink-50 px-6 py-5 sm:px-8 md:col-span-2 md:flex-row md:items-center md:gap-6">
              <p className="flex shrink-0 items-center gap-2 text-sm font-semibold text-ink-900">
                <Handshake className="h-4 w-4 text-brand-600" aria-hidden />
                {t("home.digitalSide.handoff")}
              </p>
              <ul className="flex flex-col gap-2 text-sm text-ink-600 md:flex-row md:flex-wrap md:gap-x-5">
                {points.map((p) => (
                  <li key={p} className="flex items-center gap-2">
                    <span className="h-1 w-1 shrink-0 rounded-full bg-brand-500" aria-hidden />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
