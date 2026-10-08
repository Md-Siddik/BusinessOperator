import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { buildMetadata } from "@/lib/i18n/seo";
import { getPublicContext, type LocaleParams } from "@/features/site/context";
import { ContactForm } from "@/components/site/contact-form";
import { Eyebrow } from "@/components/site/sections";

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  const { t, enabledLanguages } = await getPublicContext(locale);
  return buildMetadata({ locale, path: "/contact", title: t("meta.pages.contact.title"), description: t("meta.pages.contact.description"), enabledLanguages });
}

export default async function ContactPage({ params }: LocaleParams) {
  const { locale } = await params;
  const { t, list, messages, general } = await getPublicContext(locale);
  const formMessages = { contact: messages.contact, industries: messages.industries, serviceItems: messages.serviceItems };
  return (
    <section className="relative overflow-hidden py-14 sm:py-20">
      <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_60%)]" aria-hidden />
      <div className="container-page relative grid gap-12 lg:grid-cols-[1fr_1.6fr]">
        <div className="lg:pt-4">
          <Eyebrow>{t("contact.eyebrow")}</Eyebrow>
          <h1 className="mt-4 text-balance text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">{t("contact.title")}</h1>
          <p className="mt-5 text-lg leading-relaxed text-ink-600">{t("contact.subtitle")}</p>
          <div className="mt-10 rounded-2xl border border-ink-200 bg-white p-6 shadow-soft">
            <p className="text-sm font-semibold text-ink-900">{t("contact.asideTitle")}</p>
            <ol className="mt-4 space-y-4">
              {list<string>("contact.asideSteps").map((s, i) => (
                <li key={s} className="flex gap-3 text-sm text-ink-600">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
          </div>
          <a href={`mailto:${general.contactEmail}`} className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-ink-700 hover:text-brand-700">
            <Mail className="h-4 w-4" aria-hidden /> {general.contactEmail}
          </a>
        </div>
        <div className="rounded-3xl border border-ink-200 bg-white p-6 shadow-card sm:p-8">
          <ContactForm locale={locale} messages={formMessages} />
        </div>
      </div>
    </section>
  );
}
