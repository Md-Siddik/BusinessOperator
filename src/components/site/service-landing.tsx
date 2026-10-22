import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Briefcase,
  CalendarClock,
  Check,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  Contact,
  Database,
  Eye,
  FileText,
  Globe,
  Handshake,
  Headphones,
  LayoutDashboard,
  LineChart,
  Megaphone,
  MonitorSmartphone,
  Network,
  Palette,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Tag,
  TrendingUp,
  Users,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { localizedPath, LANGUAGE_CODES } from "@/config/languages";
import { ENGAGEMENT_MODELS, engagementPath } from "@/config/engagement";
import { absoluteUrl, siteConfig } from "@/config/site";
import type { PublicCaseStudy } from "@/features/content/service";
import type { ServiceView } from "@/features/service-catalog/view";
import type { Translator } from "@/lib/i18n/translator";
import { priceDisplay, priceLabelsFrom, type PriceDisplay } from "@/lib/service-pricing";
import { cn } from "@/lib/utils";
import { ButtonLink } from "@/components/ui/button";
import { CtaBand, Eyebrow, SectionHeading } from "./sections";
import { WorkCard } from "./portfolio";
import { BuildFirstTeaser } from "./build-first";

type T = Translator["t"];

export const SERVICE_PAGE_ICONS: Record<string, LucideIcon> = { MonitorSmartphone, Network, Contact, Search, Palette, Megaphone, Database, Users, Workflow, RefreshCw, Globe, LayoutDashboard, TrendingUp, Boxes, Headphones, Briefcase, ShoppingCart, LineChart };

export function servicePrice(service: ServiceView, t: T, locale: string, now = new Date()) {
  return priceDisplay(service.pricing, service.discount, priceLabelsFrom(t), locale, now);
}

export function deliveryText(service: ServiceView, t: T) {
  return service.landing.delivery || t("servicePages.ui.delivery.open");
}

/** A site path from the Owner ("/contact") is localised for the visitor's language; anchors and https links stay. */
export function localHref(locale: string, href: string) {
  if (!href.startsWith("/")) return href;
  const first = href.split(/[/?#]/)[1] ?? "";
  return (LANGUAGE_CODES as string[]).includes(first) ? href : `${localizedPath(locale, href.split(/[?#]/)[0]!)}${href.slice(href.split(/[?#]/)[0]!.length)}`;
}

/** The call to action: the Owner's label and destination, or "Request an Offer" to the contact form with the need preselected. */
export function serviceCta(service: ServiceView, locale: string, t: T) {
  return {
    label: service.cta.label || t("servicePages.ui.requestOffer"),
    href: service.cta.href ? localHref(locale, service.cta.href) : `${localizedPath(locale, "/contact")}?need=${service.contactNeed}&service=${service.slug}`,
  };
}

function dateText(d: Date, locale: string) {
  return d.toLocaleDateString(locale === "no" ? "nb-NO" : locale === "en" ? "en-GB" : locale, { day: "numeric", month: "long", year: "numeric" });
}

/** Price, with a sober discount line when one is active — a business offer, not a sale banner. */
function PriceBlock({ price, t, locale, size = "md" }: { price: PriceDisplay; t: T; locale: string; size?: "md" | "lg" }) {
  return (
    <div>
      <p className={cn("font-semibold text-ink-900", size === "lg" ? "text-lg" : "text-[0.9375rem]")}>{price.text}</p>
      {price.originalText && (
        <div className="mt-1.5 space-y-1 text-sm">
          <p className="text-ink-500">
            {t("servicePages.ui.regularPrice")}: <s>{price.originalText}</s>
          </p>
          <p className="inline-flex items-center gap-1.5 rounded-md border border-brand-200 bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-800">
            <Tag className="h-3.5 w-3.5" aria-hidden /> {price.discountLabel}
          </p>
          {price.validUntil && <p className="text-xs text-ink-500">{t("servicePages.ui.validUntil", { date: dateText(price.validUntil, locale) })}</p>}
        </div>
      )}
    </div>
  );
}

function CheckList({ items, tone = "brand", columns = 2 }: { items: string[]; tone?: "brand" | "muted" | "plus"; columns?: 1 | 2 }) {
  const Icon = tone === "muted" ? X : tone === "plus" ? Plus : Check;
  return (
    <ul className={cn("grid gap-2.5", columns === 2 && "sm:grid-cols-2")}>
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3 text-[0.9375rem] leading-6 text-ink-700">
          <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full", tone === "muted" ? "bg-ink-100 text-ink-500" : "bg-brand-50 text-brand-600")} aria-hidden>
            <Icon className="h-3 w-3" strokeWidth={2.75} />
          </span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** Concise card linking to one landing page: icon, name, one line, starting price, "Learn more". */
export function ServiceCard({ service, locale, t }: { service: ServiceView; locale: string; t: T }) {
  const Icon = SERVICE_PAGE_ICONS[service.icon] ?? MonitorSmartphone;
  const price = servicePrice(service, t, locale);
  return (
    <Link
      href={localizedPath(locale, `/services/${service.slug}`)}
      className="group flex h-full flex-col rounded-2xl border border-ink-200 bg-white p-6 shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lifted"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100 transition-colors group-hover:bg-brand-600 group-hover:text-white group-hover:ring-brand-600" aria-hidden>
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-5 text-lg font-semibold tracking-tight text-ink-900">{service.shortTitle || service.name}</h3>
      <p className="mt-1.5 flex-1 text-sm leading-relaxed text-ink-600">{service.shortDescription}</p>
      {price.hasPrice && <p className="mt-4 text-sm font-medium text-ink-800">{price.text}</p>}
      <span className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-ink-800 group-hover:text-brand-700">
        {t("cta.learnMore")} <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
        <span className="sr-only">: {service.name}</span>
      </span>
    </Link>
  );
}

/** A "wide" service (the long-term partner), presented as the relationship around the single services. */
export function PartnerCard({ service, locale, t }: { service: ServiceView; locale: string; t: T }) {
  return (
    <Link href={localizedPath(locale, `/services/${service.slug}`)} className="group relative isolate flex flex-col gap-6 overflow-hidden rounded-3xl bg-night-900 p-7 text-white shadow-lifted transition-transform duration-200 hover:-translate-y-0.5 sm:p-9 lg:flex-row lg:items-center lg:justify-between">
      <div className="pointer-events-none absolute -right-24 -top-32 -z-10 h-80 w-80 rounded-full bg-brand-600/30 blur-3xl" aria-hidden />
      <div className="max-w-2xl">
        <Eyebrow tone="dark">{t("homeV2.services.partnerEyebrow")}</Eyebrow>
        <h3 className="mt-3 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{service.landing.heroTitle || service.name}</h3>
        <p className="mt-3 text-pretty leading-relaxed text-ink-300">{service.landing.heroSubtitle || service.shortDescription}</p>
      </div>
      <span className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-white">
        {t("homeV2.services.partnerCta")} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}

/** Regular services in a grid; "wide" services (the long-term partner) below as a band. */
export function ServiceCardsGrid({ services, locale, t }: { services: ServiceView[]; locale: string; t: T }) {
  const cards = services.filter((s) => s.presentation !== "wide");
  const wide = services.filter((s) => s.presentation === "wide");
  if (!services.length) return null;
  return (
    <div className="space-y-5">
      {cards.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((s) => (
            <ServiceCard key={s.slug} service={s} locale={locale} t={t} />
          ))}
        </div>
      )}
      {wide.map((s) => (
        <PartnerCard key={s.slug} service={s} locale={locale} t={t} />
      ))}
    </div>
  );
}

const ENGAGEMENT_ICONS: Record<string, LucideIcon> = { monthly: RefreshCw, project: ClipboardCheck, growth: Handshake };

/**
 * How the client can engage — deliberately separate from the service price.
 * Monthly and task-based side by side; the growth partnership apart, as a selective relationship.
 */
function EngagementOptions({ service, locale, t }: { service: ServiceView; locale: string; t: T }) {
  const options = service.engagementOptions;
  if (!options.length) return null;
  const regular = ENGAGEMENT_MODELS.filter((m) => m.key !== "growth" && options.includes(m.key as "monthly" | "project"));
  const growth = options.includes("growth") ? ENGAGEMENT_MODELS.find((m) => m.key === "growth") : undefined;
  return (
    <div className="rounded-3xl border border-ink-200 bg-white p-7 shadow-soft sm:p-9">
      <h2 className="text-xl font-semibold tracking-tight text-ink-900">{t("servicePages.ui.engagementTitle")}</h2>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-600">{t("servicePages.ui.engagementText")}</p>
      {regular.length > 0 && (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {regular.map((m) => {
            const Icon = ENGAGEMENT_ICONS[m.key] ?? ClipboardCheck;
            return (
              <li key={m.key}>
                <Link href={localizedPath(locale, engagementPath(m))} className="group flex h-full flex-col rounded-2xl border border-ink-200 p-4 transition-colors hover:border-brand-200 hover:bg-brand-50/40">
                  <span className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                    <Icon className="h-4 w-4 text-brand-600" aria-hidden /> {t(`home.engagement.models.${m.key}.title`)}
                  </span>
                  <span className="mt-1.5 text-sm leading-relaxed text-ink-600">{t(`home.engagement.models.${m.key}.text`)}</span>
                  <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-700">
                    {t("servicePages.ui.engagementCta")} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {growth && (
        <Link href={localizedPath(locale, engagementPath(growth))} className="group mt-4 flex flex-col gap-3 rounded-2xl bg-night-900 p-5 text-white sm:flex-row sm:items-center sm:justify-between">
          <span>
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Handshake className="h-4 w-4 text-signal-300" aria-hidden /> {t("home.engagement.models.growth.title")}
            </span>
            <span className="mt-1 block text-sm leading-relaxed text-ink-300">{t("servicePages.ui.growthNote")}</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-white">
            {t("servicePages.ui.engagementCta")} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </Link>
      )}
    </div>
  );
}

/**
 * One focused landing page: what it is → who it is for → the problem → what we do →
 * what is included → how it works → what you receive + price → how to engage →
 * examples → FAQ → what happens next → related services → CTA. Every text comes from the
 * Service record (Service Management) in the visitor's language.
 */
export function ServiceLanding({ service, related, locale, t, cases, preview, editHref }: { service: ServiceView; related: ServiceView[]; locale: string; t: T; cases: PublicCaseStudy[]; preview?: boolean; editHref?: string }) {
  const ui = "servicePages.ui";
  const l = service.landing;
  const Icon = SERVICE_PAGE_ICONS[service.icon] ?? MonitorSmartphone;
  const price = servicePrice(service, t, locale);
  const cta = serviceCta(service, locale, t);
  const url = absoluteUrl(localizedPath(locale, `/services/${service.slug}`));

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: service.name,
      description: service.seo.description || service.shortDescription,
      serviceType: service.name,
      provider: { "@type": "Organization", name: siteConfig.name, url: siteConfig.url },
      areaServed: "Europe",
      url,
      ...(price.hasPrice && service.pricing.amount && { offers: { "@type": "Offer", priceCurrency: service.pricing.currency, price: service.pricing.amount, url } }),
    },
    ...(l.faq.length ? [{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: l.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }] : []),
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: t("nav.home"), item: absoluteUrl(localizedPath(locale, "/")) },
        { "@type": "ListItem", position: 2, name: t(`${ui}.breadcrumb`), item: absoluteUrl(localizedPath(locale, "/services")) },
        { "@type": "ListItem", position: 3, name: service.name, item: url },
      ],
    },
  ];

  return (
    <>
      {preview && (
        <div className="border-b border-amber-200 bg-amber-50" role="note">
          <div className="container-page flex flex-wrap items-center justify-between gap-3 py-3 text-sm text-amber-900">
            <span className="flex items-center gap-2">
              <Eye className="h-4 w-4 shrink-0" aria-hidden /> {t(`${ui}.previewBanner`)}
            </span>
            {editHref && (
              <a href={editHref} className="font-semibold underline">
                {t(`${ui}.previewEdit`)}
              </a>
            )}
          </div>
        </div>
      )}

      {/* Hero: what the service is, and the price up front. */}
      <section className="relative overflow-hidden border-b border-ink-100">
        <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" aria-hidden />
        <div className="container-page relative grid gap-10 py-14 sm:py-20 lg:grid-cols-[1.5fr_1fr] lg:items-end lg:gap-14">
          <div className="min-w-0 animate-fade-up">
            <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-x-2 text-sm text-ink-500">
              <Link href={localizedPath(locale, "/")} className="hover:text-ink-800">
                {t("nav.home")}
              </Link>
              <span aria-hidden>/</span>
              <Link href={localizedPath(locale, "/services")} className="hover:text-ink-800">
                {t(`${ui}.breadcrumb`)}
              </Link>
              <span aria-hidden>/</span>
              <span className="text-ink-800">{service.name}</span>
            </nav>
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100" aria-hidden>
                <Icon className="h-5 w-5" />
              </span>
              <Eyebrow>{service.name}</Eyebrow>
            </div>
            <h1 className="mt-5 text-balance text-4xl font-semibold tracking-[-0.03em] text-ink-900 sm:text-5xl">{l.heroTitle || service.name}</h1>
            {(l.heroSubtitle || service.shortDescription) && <p className="mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-ink-600">{l.heroSubtitle || service.shortDescription}</p>}
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href={cta.href} size="lg">
                {cta.label} <ArrowRight className="h-4 w-4" aria-hidden />
              </ButtonLink>
              {/* Only point to examples that exist; otherwise to the price and delivery details. */}
              <ButtonLink href={cases.length ? "#examples" : "#pricing"} size="lg" variant="outline">
                {cases.length ? t(`${ui}.seeWork`) : t(`${ui}.pricingTitle`)}
              </ButtonLink>
            </div>
          </div>
          <dl className="rounded-2xl border border-ink-200 bg-white p-6 shadow-card">
            <div className="flex gap-3">
              <CircleDollarSign className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden />
              <div className="min-w-0">
                <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">{t(`${ui}.priceLabel`)}</dt>
                <dd className="mt-1">
                  <PriceBlock price={price} t={t} locale={locale} />
                  {service.pricing.note && <p className="mt-1 text-xs text-ink-500">{service.pricing.note}</p>}
                </dd>
              </div>
            </div>
            <div className="mt-5 flex gap-3 border-t border-ink-100 pt-5">
              <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden />
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">{t(`${ui}.deliveryLabel`)}</dt>
                <dd className="mt-1 text-[0.9375rem] font-semibold text-ink-900">{deliveryText(service, t)}</dd>
              </div>
            </div>
            <p className="mt-5 flex gap-3 border-t border-ink-100 pt-5 text-sm leading-relaxed text-ink-600">
              <FileText className="mt-0.5 h-5 w-5 shrink-0 text-ink-400" aria-hidden />
              {t(`${ui}.priceNote`)}
            </p>
          </dl>
        </div>
      </section>

      {/* Who it is for, the problem, and how we solve it. */}
      <section className="py-16 sm:py-24">
        <div className="container-page space-y-6">
          {l.whoFor.length > 0 && (
            <div className="rounded-3xl border border-ink-200 bg-white p-7 shadow-soft">
              <Eyebrow>{t(`${ui}.whoForTitle`)}</Eyebrow>
              <div className="mt-5">
                <CheckList items={l.whoFor} />
              </div>
            </div>
          )}
          {(l.problem.length > 0 || l.solution) && (
            <div className="grid gap-6 md:grid-cols-2">
              {l.problem.length > 0 && (
                <div className="rounded-3xl border border-ink-200 bg-ink-50/60 p-7">
                  <Eyebrow className="text-ink-500">{t(`${ui}.problemTitle`)}</Eyebrow>
                  <div className="mt-5">
                    <CheckList items={l.problem} tone="muted" columns={1} />
                  </div>
                </div>
              )}
              {l.solution && (
                <div className="rounded-3xl border border-brand-200 bg-brand-50/60 p-7">
                  <Eyebrow>{t(`${ui}.solutionTitle`)}</Eyebrow>
                  <p className="mt-5 text-lg leading-relaxed text-ink-800">{l.solution}</p>
                </div>
              )}
            </div>
          )}
          {service.description && <p className="max-w-3xl text-pretty leading-relaxed text-ink-700">{service.description}</p>}
        </div>
      </section>

      {l.included.length > 0 && (
        <section className="pb-16 sm:pb-24">
          <div className="container-page">
            <SectionHeading title={t(`${ui}.includedTitle`)} />
            <div className="mt-8 rounded-3xl border border-ink-200 bg-white p-6 shadow-soft sm:p-8">
              <CheckList items={l.included} />
            </div>
          </div>
        </section>
      )}

      {l.steps.length > 0 && (
        <section className="border-y border-ink-100 bg-mist py-16 sm:py-24">
          <div className="container-page">
            <SectionHeading title={t(`${ui}.howTitle`)} />
            <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {l.steps.map((s, i) => (
                <li key={`${s.title}-${i}`} className="rounded-2xl border border-ink-200 bg-white p-5 shadow-soft">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full border border-brand-200 bg-brand-50 text-sm font-semibold tabular-nums text-brand-700">0{i + 1}</span>
                  <h3 className="mt-4 text-base font-semibold text-ink-900">{s.title}</h3>
                  {s.text && <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{s.text}</p>}
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {/* What you receive + the service price. */}
      <section className="py-16 sm:py-24">
        <div className="container-page grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-12">
          <div className="min-w-0">
            {l.deliverables.length > 0 && (
              <>
                <SectionHeading title={t(`${ui}.deliverablesTitle`)} />
                <ul className="mt-8 grid gap-3 sm:grid-cols-2">
                  {l.deliverables.map((d) => (
                    <li key={d} className="flex gap-3 rounded-2xl border border-ink-200 bg-white p-4 text-sm leading-relaxed text-ink-800 shadow-soft">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                      {d}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className={cn(l.deliverables.length > 0 && "mt-8")}>
              <EngagementOptions service={service} locale={locale} t={t} />
            </div>
          </div>
          <div id="pricing" className="scroll-mt-24 self-start rounded-3xl border border-ink-200 bg-white p-7 shadow-card">
            <h2 className="text-xl font-semibold tracking-tight text-ink-900">{t(`${ui}.pricingTitle`)}</h2>
            <dl className="mt-5 grid gap-5 sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">{t(`${ui}.priceLabel`)}</dt>
                <dd className="mt-1">
                  <PriceBlock price={price} t={t} locale={locale} size="lg" />
                  {service.pricing.note && <p className="mt-1 text-xs text-ink-500">{service.pricing.note}</p>}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">{t(`${ui}.deliveryLabel`)}</dt>
                <dd className="mt-1 font-semibold text-ink-900">{deliveryText(service, t)}</dd>
              </div>
            </dl>
            <p className="mt-4 text-xs leading-relaxed text-ink-500">{t(`${ui}.servicePriceNote`)}</p>
            {l.notIncluded.length > 0 && (
              <div className="mt-6 border-t border-ink-100 pt-5">
                <p className="text-sm font-semibold text-ink-900">{t(`${ui}.notIncludedTitle`)}</p>
                <div className="mt-3">
                  <CheckList items={l.notIncluded} tone="muted" columns={1} />
                </div>
              </div>
            )}
            {l.optional.length > 0 && (
              <div className="mt-6 border-t border-ink-100 pt-5">
                <p className="text-sm font-semibold text-ink-900">{t(`${ui}.optionalTitle`)}</p>
                <div className="mt-3">
                  <CheckList items={l.optional} tone="plus" columns={1} />
                </div>
              </div>
            )}
            <p className="mt-6 rounded-xl bg-ink-50 p-4 text-sm leading-relaxed text-ink-600">{t(`${ui}.priceNote`)}</p>
            <ButtonLink href={cta.href} className="mt-6 w-full">
              {cta.label} <ArrowRight className="h-4 w-4" aria-hidden />
            </ButtonLink>
          </div>
        </div>
      </section>

      {/* Real, published examples only — the section is not shown until there are some. */}
      {cases.length > 0 && (
        <section id="examples" className="scroll-mt-24 border-y border-ink-100 bg-mist py-16 sm:py-24">
          <div className="container-page">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <SectionHeading title={t(`${ui}.examplesTitle`)} subtitle={t(`${ui}.examplesSubtitle`)} />
              <Link href={localizedPath(locale, "/work")} className="group inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:text-brand-800">
                {t("homeV2.work.cta")} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </div>
            <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {cases.map((c) => (
                <WorkCard key={c.slug} c={c} locale={locale} t={t} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Website projects can start with "Build before you commit". */}
      {service.contactNeed === "website" && (
        <section className="pt-4">
          <div className="container-page">
            <BuildFirstTeaser locale={locale} t={t} />
          </div>
        </section>
      )}

      {l.longTerm && (
        <section className="py-16 sm:py-24">
          <div className="container-page">
            <div className="relative isolate overflow-hidden rounded-3xl bg-night-900 p-7 text-white shadow-lifted sm:p-9">
              <div className="pointer-events-none absolute -right-24 -top-28 -z-10 h-72 w-72 rounded-full bg-brand-600/30 blur-3xl" aria-hidden />
              <Eyebrow tone="dark">{t(`${ui}.longTermTitle`)}</Eyebrow>
              <p className="mt-4 max-w-3xl text-lg leading-relaxed text-brand-50">{l.longTerm}</p>
            </div>
          </div>
        </section>
      )}

      {l.faq.length > 0 && (
        <section className="border-t border-ink-100 py-16 sm:py-24">
          <div className="container-page max-w-3xl">
            <SectionHeading title={t(`${ui}.faqTitle`)} />
            <div className="mt-8 divide-y divide-ink-200 rounded-2xl border border-ink-200 bg-white">
              {l.faq.map((f) => (
                <details key={f.q} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-medium text-ink-900">
                    {f.q}
                    <ChevronDown className="h-4 w-4 shrink-0 text-ink-400 transition-transform group-open:rotate-180" aria-hidden />
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-ink-600">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* What happens next. */}
      <section className="border-t border-ink-100 py-16 sm:py-20">
        <div className="container-page grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-center">
          <div>
            <SectionHeading title={t(`${ui}.nextStepTitle`)} />
            <p className="mt-4 max-w-2xl text-pretty leading-relaxed text-ink-600">{l.nextStep || t(`${ui}.nextStepDefault`)}</p>
          </div>
          <div className="flex flex-wrap gap-3 lg:justify-end">
            <ButtonLink href={cta.href} size="lg">
              {cta.label} <ArrowRight className="h-4 w-4" aria-hidden />
            </ButtonLink>
          </div>
        </div>
      </section>

      {related.length > 0 && (
        <section className="border-t border-ink-100 py-16 sm:py-20">
          <div className="container-page">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <SectionHeading title={t(`${ui}.relatedTitle`)} subtitle={t(`${ui}.relatedSubtitle`)} />
              <Link href={localizedPath(locale, "/services")} className="group inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:text-brand-800">
                {t(`${ui}.allServices`)} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((s) => (
                <ServiceCard key={s.slug} service={s} locale={locale} t={t} />
              ))}
            </div>
          </div>
        </section>
      )}

      <CtaBand locale={locale} t={t} title={t(`${ui}.ctaTitle`)} subtitle={t(`${ui}.ctaSubtitle`)} />
      <div className="container-page pb-12">
        <Link href={localizedPath(locale, "/")} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-900">
          <ArrowLeft className="h-4 w-4" aria-hidden /> {t(`${ui}.backHome`)}
        </Link>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
    </>
  );
}
