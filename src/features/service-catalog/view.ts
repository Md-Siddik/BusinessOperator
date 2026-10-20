import { SERVICE_PAGES, type ServicePage } from "@/config/service-pages";
import type { ServiceDiscount, ServicePricing } from "@/lib/service-pricing";

/**
 * A service as the public website shows it, in one language (client-safe, no I/O).
 * Built from a Service record (base text + translation overrides) or — when no database is
 * available, e.g. at build time — from the built-in defaults in src/config/service-pages.ts
 * and the dictionaries. Never contains internal fields (createdBy, deletedAt, …).
 */
export type ServiceStep = { title: string; text: string };
export type ServiceFaq = { q: string; a: string };
export type EngagementOption = "monthly" | "project" | "growth";

export type ServiceLanding = {
  heroTitle: string;
  heroSubtitle: string;
  whoFor: string[];
  problem: string[];
  solution: string;
  included: string[];
  steps: ServiceStep[];
  deliverables: string[];
  notIncluded: string[];
  optional: string[];
  delivery?: string;
  longTerm?: string;
  nextStep?: string;
  faq: ServiceFaq[];
};

export type ServiceView = {
  id?: string;
  slug: string;
  name: string;
  shortTitle: string;
  shortDescription: string;
  description?: string;
  icon: string;
  presentation: "card" | "wide";
  active: boolean;
  featured: boolean;
  displayOrder: number;
  pricing: ServicePricing & { note?: string };
  discount: ServiceDiscount | null;
  engagementOptions: EngagementOption[];
  cta: { label?: string; href?: string };
  contactNeed: string;
  landing: ServiceLanding;
  related: string[];
  portfolioServices: string[];
  seo: { title?: string; description?: string; noindex: boolean };
  updatedAt?: string;
};

type Raw = <T = unknown>(key: string) => T | undefined;
type Loose = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
const pairs = (v: unknown): ServiceStep[] => (Array.isArray(v) ? v.filter((x): x is ServiceStep => !!x && typeof x === "object" && !!str((x as Loose).title)) : []);
const faqs = (v: unknown): ServiceFaq[] => (Array.isArray(v) ? v.filter((x): x is ServiceFaq => !!x && typeof x === "object" && !!str((x as Loose).q) && !!str((x as Loose).a)) : []);

/** Merge: a translated value wins when it is present (non-empty string / non-empty list). */
function pick<T>(base: T, override: T | undefined): T {
  if (override === undefined || override === null) return base;
  if (typeof override === "string" && !override.trim()) return base;
  if (Array.isArray(override) && override.length === 0) return base;
  return override;
}

function landingFrom(base: Loose | undefined, tr: Loose | undefined): ServiceLanding {
  const b = base ?? {};
  const o = tr ?? {};
  return {
    heroTitle: pick(str(b.heroTitle) ?? "", str(o.heroTitle)),
    heroSubtitle: pick(str(b.heroSubtitle) ?? "", str(o.heroSubtitle)),
    whoFor: pick(strs(b.whoFor), strs(o.whoFor)),
    problem: pick(strs(b.problem), strs(o.problem)),
    solution: pick(str(b.solution) ?? "", str(o.solution)),
    included: pick(strs(b.included), strs(o.included)),
    steps: pick(pairs(b.steps), pairs(o.steps)),
    deliverables: pick(strs(b.deliverables), strs(o.deliverables)),
    notIncluded: pick(strs(b.notIncluded), strs(o.notIncluded)),
    optional: pick(strs(b.optional), strs(o.optional)),
    delivery: pick(str(b.delivery), str(o.delivery)),
    longTerm: pick(str(b.longTerm), str(o.longTerm)),
    nextStep: pick(str(b.nextStep), str(o.nextStep)),
    faq: pick(faqs(b.faq), faqs(o.faq)),
  };
}

/** A stored Service (lean document) in one language. */
export function serviceToView(doc: Loose, locale: string): ServiceView {
  const translations = doc.translations as Map<string, Loose> | Record<string, Loose> | undefined;
  const tr = (translations instanceof Map ? translations.get(locale) : translations?.[locale]) as Loose | undefined;
  const t = locale === "en" ? undefined : tr;
  const pricing = (doc.pricing ?? {}) as Loose;
  const discount = (doc.discount ?? {}) as Loose;
  const seo = (doc.seo ?? {}) as Loose;
  const trSeo = (t?.seo ?? {}) as Loose;
  const cta = (doc.cta ?? {}) as Loose;
  const name = pick(str(doc.name) ?? String(doc.slug), str(t?.name));
  return {
    id: doc._id ? String(doc._id) : undefined,
    slug: String(doc.slug),
    name,
    shortTitle: pick(str(doc.shortTitle) ?? name, str(t?.shortTitle)),
    shortDescription: pick(str(doc.shortDescription) ?? "", str(t?.shortDescription)),
    description: pick(str(doc.description), str(t?.description)),
    icon: str(doc.icon) ?? "MonitorSmartphone",
    presentation: doc.presentation === "wide" ? "wide" : "card",
    active: !!doc.active && !doc.deletedAt,
    featured: !!doc.featured,
    displayOrder: typeof doc.displayOrder === "number" ? doc.displayOrder : 100,
    pricing: {
      model: (str(pricing.model) ?? "quote") as ServicePricing["model"],
      amount: typeof pricing.amount === "number" ? pricing.amount : null,
      currency: str(pricing.currency) ?? "NOK",
      note: pick(str(pricing.note), str(t?.pricingNote)),
    },
    discount: discount.enabled ? { enabled: true, type: discount.type as ServiceDiscount["type"], value: discount.value as number, label: pick(str(discount.label), str(t?.discountLabel)) ?? null, startsAt: (discount.startsAt as Date) ?? null, endsAt: (discount.endsAt as Date) ?? null } : null,
    engagementOptions: strs(doc.engagementOptions).filter((x): x is EngagementOption => ["monthly", "project", "growth"].includes(x)),
    cta: { label: pick(str(cta.label), str(t?.ctaLabel)), href: str(cta.href) },
    contactNeed: str(doc.contactNeed) ?? "notSure",
    landing: landingFrom(doc.landing as Loose, t?.landing as Loose),
    related: strs(doc.related),
    portfolioServices: strs(doc.portfolioServices),
    seo: { title: pick(str(seo.title), str(trSeo.title)), description: pick(str(seo.description), str(trSeo.description)), noindex: !!seo.noindex },
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt as string).toISOString() : undefined,
  };
}

/* ───────────── Built-in defaults (the original ten landing pages) ───────────── */

/** Services shown on the homepage out of the box (the Owner changes this in Service Management). */
export const DEFAULT_FEATURED = ["web-development", "web-crm", "seo", "automation", "recruitment", "digital-operations"];

/** Stored-record shape of one built-in service, from the dictionary text of one language. */
export function defaultServiceRecord(page: ServicePage, raw: Raw, index: number) {
  const c = raw<Loose>(`servicePages.${page.key}`) ?? {};
  const partner = page.contactNeed === "ongoing";
  return {
    slug: page.slug,
    name: str(c.name) ?? page.slug,
    shortTitle: str(c.name),
    shortDescription: str(c.card),
    description: str(c.metaDescription),
    category: partner ? "Ongoing partnership" : undefined,
    icon: page.icon,
    presentation: partner ? ("wide" as const) : ("card" as const),
    active: true,
    featured: DEFAULT_FEATURED.includes(page.slug),
    displayOrder: (index + 1) * 10,
    // No approved prices exist: the model only — never an invented amount.
    pricing: { model: page.pricing.kind, amount: page.pricing.amountNok ?? undefined, currency: "NOK" as const },
    discount: { enabled: false },
    engagementOptions: partner ? (["monthly", "growth"] as EngagementOption[]) : (["project", "monthly"] as EngagementOption[]),
    cta: {},
    contactNeed: page.contactNeed,
    landing: {
      heroTitle: str(c.heroTitle),
      heroSubtitle: str(c.heroSubtitle),
      problem: strs(c.problem),
      solution: str(c.solution),
      included: strs(c.included),
      steps: pairs(c.steps),
      deliverables: strs(c.deliverables),
      notIncluded: strs(c.notIncluded),
      optional: strs(c.optional),
      longTerm: str(c.longTerm),
      faq: faqs(c.faq),
    },
    related: page.related,
    portfolioServices: page.portfolio,
    seo: { title: str(c.metaTitle), description: str(c.metaDescription), noindex: false },
  };
}

/** The translatable part of a default record (for a translation override). */
export function defaultTranslation(page: ServicePage, raw: Raw) {
  const r = defaultServiceRecord(page, raw, 0);
  return { name: r.name, shortTitle: r.shortTitle, shortDescription: r.shortDescription, description: r.description, landing: r.landing, seo: { title: r.seo.title, description: r.seo.description } };
}

/** The built-in services in one language — used when the database is unavailable. */
export function defaultServiceViews(locale: string, raw: Raw): ServiceView[] {
  return SERVICE_PAGES.map((p, i) => serviceToView(defaultServiceRecord(p, raw, i) as unknown as Loose, locale));
}

export function sortServices(views: ServiceView[]) {
  return [...views].sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
}
