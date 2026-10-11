import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";
import { LANGUAGE_CODES, localizedPath } from "@/config/languages";
import { ENGAGEMENT_MODELS, getEngagementModel } from "@/config/engagement";
import { buildMetadata } from "@/lib/i18n/seo";
import { getPublicContext } from "@/features/site/context";
import { ButtonLink } from "@/components/ui/button";
import { Eyebrow } from "@/components/site/sections";
import { ENGAGEMENT_ICONS } from "@/components/site/engagement-models";

type Params = { params: Promise<{ locale: string; slug: string }> };
type Block = { title: string; text?: string; items?: string[]; structures?: { title: string; text: string }[] };

export function generateStaticParams() {
  return LANGUAGE_CODES.flatMap((locale) => ENGAGEMENT_MODELS.map((m) => ({ locale, slug: m.slug })));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, slug } = await params;
  const model = getEngagementModel(slug);
  if (!model) return {};
  const { t, enabledLanguages } = await getPublicContext(locale);
  return buildMetadata({
    locale,
    path: `/engagement/${slug}`,
    title: t(`engagement.models.${model.key}.title`),
    description: t(`engagement.models.${model.key}.subtitle`),
    enabledLanguages,
  });
}

export default async function EngagementDetailPage({ params }: Params) {
  const { locale, slug } = await params;
  const model = getEngagementModel(slug);
  if (!model) notFound();
  const { t, list } = await getPublicContext(locale);
  const k = `engagement.models.${model.key}`;
  const Icon = ENGAGEMENT_ICONS[model.key]!;
  const contactHref = `${localizedPath(locale, "/contact")}?engagement=${model.key}`;
  const others = ENGAGEMENT_MODELS.filter((m) => m.slug !== slug);

  return (
    <>
      <section className="relative overflow-hidden border-b border-ink-100">
        <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" aria-hidden />
        <div className="container-page relative py-16 sm:py-24">
          <div className="max-w-3xl animate-fade-up">
            <nav aria-label="Breadcrumb" className="mb-6 text-sm text-ink-500">
              <Link href={localizedPath(locale, "/")} className="hover:text-ink-800">
                {t("nav.home")}
              </Link>
              <span className="mx-2" aria-hidden>
                /
              </span>
              <span className="text-ink-800">{t(`${k}.title`)}</span>
            </nav>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 ring-1 ring-brand-100">
              <Icon className="h-6 w-6" aria-hidden />
            </span>
            <Eyebrow className="mt-6">{t("engagement.eyebrow")}</Eyebrow>
            <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">{t(`${k}.title`)}</h1>
            <p className="mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-ink-600">{t(`${k}.subtitle`)}</p>
            <ButtonLink href={contactHref} size="lg" className="mt-8">
              {t(`${k}.cta`)} <ArrowRight className="h-4 w-4" aria-hidden />
            </ButtonLink>
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-24">
        <div className="container-page max-w-4xl space-y-4">
          {list<Block>(`${k}.sections`).map((b) => (
            <div key={b.title} className="rounded-2xl border border-ink-200 bg-white p-6 shadow-soft sm:p-7">
              <h2 className="text-xl font-semibold tracking-tight text-ink-900">{b.title}</h2>
              {b.text && <p className="mt-3 leading-relaxed text-ink-600">{b.text}</p>}
              {b.items && (
                <ul className="mt-4 space-y-2.5">
                  {b.items.map((item) => (
                    <li key={item} className="flex gap-3 text-ink-700">
                      <Check className="mt-1 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                      {item}
                    </li>
                  ))}
                </ul>
              )}
              {b.structures && (
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  {b.structures.map((s) => (
                    <div key={s.title} className="rounded-xl border border-ink-200 bg-ink-50/60 p-5">
                      <h3 className="text-base font-semibold text-ink-900">{s.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-ink-600">{s.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="pb-4">
        <div className="container-page">
          <p className="text-sm font-semibold text-ink-900">{t("engagement.otherModels")}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {others.map((o) => (
              <Link key={o.slug} href={localizedPath(locale, `/engagement/${o.slug}`)} className="rounded-full border border-ink-200 bg-white px-4 py-2 text-sm text-ink-700 hover:border-brand-200 hover:text-brand-700">
                {t(`engagement.models.${o.key}.title`)}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-24">
        <div className="container-page">
          <div className="relative overflow-hidden rounded-3xl bg-brand-950 px-6 py-14 text-center shadow-lifted sm:px-12 sm:py-16">
            <div className="pointer-events-none absolute inset-0 opacity-50 [background:radial-gradient(40rem_20rem_at_50%_-20%,#3d66f0,transparent)]" aria-hidden />
            <h2 className="relative mx-auto max-w-2xl text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">{t(`${k}.ctaTitle`)}</h2>
            <p className="relative mx-auto mt-4 max-w-xl text-pretty text-brand-100/80">{t(`${k}.ctaText`)}</p>
            <ButtonLink href={contactHref} size="lg" className="relative mt-8 bg-white text-ink-900 hover:bg-brand-50">
              {t(`${k}.cta`)} <ArrowRight className="h-4 w-4" aria-hidden />
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
