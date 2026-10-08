import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Check, Eye } from "lucide-react";
import { getPublicContext } from "@/features/site/context";
import { getProspectView } from "@/features/intelligence/prospect";
import { CtaBand, Eyebrow } from "@/components/site/sections";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Personalised prospect page — built only from facts on record; never indexed. */
export default async function ProspectPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  const { t } = await getPublicContext(locale);
  const view = await getProspectView(token);
  if (!view) notFound();
  return (
    <>
      <section className="border-b border-ink-100 bg-ink-50/50">
        <div className="container-page py-16 sm:py-20">
          <Eyebrow>
            {t("prospect.eyebrow")} {view.companyName}
          </Eyebrow>
          <h1 className="mt-4 max-w-3xl text-balance text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">{t("prospect.title", { company: view.companyName })}</h1>
        </div>
      </section>
      <section className="py-14 sm:py-20">
        <div className="container-page grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-ink-200 bg-white p-7 shadow-card">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-900">
              <Eye className="h-5 w-5 text-brand-600" aria-hidden /> {t("prospect.noticedTitle")}
            </h2>
            <ul className="mt-5 space-y-3">
              {view.observations.map((o) => (
                <li key={o.key} className="flex gap-3 text-ink-700">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden />
                  {t(`prospect.${o.key}`, o.vars)}
                </li>
              ))}
            </ul>
            <p className="mt-6 text-xs text-ink-500">{t("prospect.disclaimer")}</p>
          </div>
          <div className="rounded-3xl border border-ink-200 bg-white p-7 shadow-card">
            <h2 className="text-lg font-semibold text-ink-900">{t("prospect.helpTitle")}</h2>
            <ul className="mt-5 grid gap-2.5 sm:grid-cols-2">
              {view.serviceItems.map((s) => (
                <li key={s} className="flex items-center gap-2.5 rounded-xl bg-ink-50 px-4 py-3 text-sm font-medium text-ink-800">
                  <Check className="h-4 w-4 text-brand-600" aria-hidden /> {t(`serviceItems.${s}`)}
                </li>
              ))}
            </ul>
            <div className="mt-6 rounded-2xl bg-brand-950 p-5 text-white">
              <p className="font-semibold">{t("prospect.partnershipTitle")}</p>
              <p className="mt-2 text-sm text-brand-100/85">{t("prospect.partnershipText")}</p>
            </div>
          </div>
        </div>
      </section>
      <CtaBand locale={locale} t={t} />
    </>
  );
}
