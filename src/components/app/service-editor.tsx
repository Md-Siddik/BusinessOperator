"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ExternalLink, Plus, Save, Trash2 } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { CURRENCIES, DISCOUNT_TYPES, EN_PRICE_LABELS, PRICING_MODELS, priceDisplay, type PricingModel } from "@/lib/service-pricing";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

/* ───────────── Form model ───────────── */

type Pair = { title: string; text: string };
type Faq = { q: string; a: string };
type LandingForm = {
  heroTitle: string;
  heroSubtitle: string;
  whoFor: string;
  problem: string;
  solution: string;
  included: string;
  steps: Pair[];
  deliverables: string;
  notIncluded: string;
  optional: string;
  delivery: string;
  longTerm: string;
  nextStep: string;
  faq: Faq[];
};
type LocalizedForm = { name: string; shortTitle: string; shortDescription: string; description: string; ctaLabel: string; pricingNote: string; discountLabel: string; seoTitle: string; seoDescription: string; landing: LandingForm };

export type ServiceEditorOptions = {
  icons: readonly string[];
  languages: { code: string; name: string }[];
  serviceItems: { key: string; label: string }[];
  services: { slug: string; name: string }[];
  needs: { key: string; label: string }[];
};

/** The stored record as returned by GET /api/services/:id (loosely typed: optional everywhere). */
export type ServiceRecord = Record<string, unknown> & { _id?: string; slug?: string };

const emptyLanding = (): LandingForm => ({ heroTitle: "", heroSubtitle: "", whoFor: "", problem: "", solution: "", included: "", steps: [], deliverables: "", notIncluded: "", optional: "", delivery: "", longTerm: "", nextStep: "", faq: [] });
const emptyLocalized = (): LocalizedForm => ({ name: "", shortTitle: "", shortDescription: "", description: "", ctaLabel: "", pricingNote: "", discountLabel: "", seoTitle: "", seoDescription: "", landing: emptyLanding() });

type Loose = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v : "");
const lines = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").join("\n") : "");
const toLines = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean);
const day = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : "");

function landingFromRecord(l: Loose | undefined): LandingForm {
  const x = l ?? {};
  return {
    heroTitle: s(x.heroTitle),
    heroSubtitle: s(x.heroSubtitle),
    whoFor: lines(x.whoFor),
    problem: lines(x.problem),
    solution: s(x.solution),
    included: lines(x.included),
    steps: Array.isArray(x.steps) ? (x.steps as Pair[]).map((p) => ({ title: s(p.title), text: s(p.text) })) : [],
    deliverables: lines(x.deliverables),
    notIncluded: lines(x.notIncluded),
    optional: lines(x.optional),
    delivery: s(x.delivery),
    longTerm: s(x.longTerm),
    nextStep: s(x.nextStep),
    faq: Array.isArray(x.faq) ? (x.faq as Faq[]).map((f) => ({ q: s(f.q), a: s(f.a) })) : [],
  };
}

function localizedFrom(r: Loose, isBase: boolean): LocalizedForm {
  const seo = (r.seo ?? {}) as Loose;
  const cta = (r.cta ?? {}) as Loose;
  const pricing = (r.pricing ?? {}) as Loose;
  const discount = (r.discount ?? {}) as Loose;
  return {
    name: s(r.name),
    shortTitle: s(r.shortTitle),
    shortDescription: s(r.shortDescription),
    description: s(r.description),
    ctaLabel: isBase ? s(cta.label) : s(r.ctaLabel),
    pricingNote: isBase ? s(pricing.note) : s(r.pricingNote),
    discountLabel: isBase ? s(discount.label) : s(r.discountLabel),
    seoTitle: s(seo.title),
    seoDescription: s(seo.description),
    landing: landingFromRecord(r.landing as Loose),
  };
}

function landingOut(l: LandingForm) {
  return {
    heroTitle: l.heroTitle,
    heroSubtitle: l.heroSubtitle,
    whoFor: toLines(l.whoFor),
    problem: toLines(l.problem),
    solution: l.solution,
    included: toLines(l.included),
    steps: l.steps.filter((p) => p.title.trim()).map((p) => ({ title: p.title, text: p.text })),
    deliverables: toLines(l.deliverables),
    notIncluded: toLines(l.notIncluded),
    optional: toLines(l.optional),
    delivery: l.delivery,
    longTerm: l.longTerm,
    nextStep: l.nextStep,
    faq: l.faq.filter((f) => f.q.trim() && f.a.trim()),
  };
}

const hasContent = (c: LocalizedForm) => JSON.stringify({ ...c, landing: landingOut(c.landing) }) !== JSON.stringify({ ...emptyLocalized(), landing: landingOut(emptyLanding()) });

/* ───────────── Small building blocks ───────────── */

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-2xl border border-ink-200 bg-white p-5 shadow-soft sm:p-6">
      <h2 className="text-base font-semibold text-ink-900">{title}</h2>
      {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

function PairList<T extends Record<string, string>>({ items, onChange, fields, addLabel }: { items: T[]; onChange: (v: T[]) => void; fields: { key: keyof T & string; label: string; long?: boolean }[]; addLabel: string }) {
  const update = (i: number, key: string, value: string) => onChange(items.map((it, j) => (j === i ? { ...it, [key]: value } : it)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...items];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i} className="rounded-xl border border-ink-200 bg-ink-50/50 p-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="grid gap-2">
              {fields.map((f) =>
                f.long ? (
                  <Textarea key={f.key} rows={2} value={it[f.key] ?? ""} onChange={(e) => update(i, f.key, e.target.value)} placeholder={f.label} aria-label={`${f.label} ${i + 1}`} />
                ) : (
                  <Input key={f.key} value={it[f.key] ?? ""} onChange={(e) => update(i, f.key, e.target.value)} placeholder={f.label} aria-label={`${f.label} ${i + 1}`} />
                ),
              )}
            </div>
            <div className="flex gap-1 sm:flex-col">
              <button type="button" onClick={() => move(i, -1)} className="rounded-md p-1.5 text-ink-500 hover:bg-white" aria-label="Move up">
                <ArrowUp className="h-4 w-4" aria-hidden />
              </button>
              <button type="button" onClick={() => move(i, 1)} className="rounded-md p-1.5 text-ink-500 hover:bg-white" aria-label="Move down">
                <ArrowDown className="h-4 w-4" aria-hidden />
              </button>
              <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="rounded-md p-1.5 text-ink-500 hover:bg-white hover:text-red-700" aria-label="Remove">
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => onChange([...items, Object.fromEntries(fields.map((f) => [f.key, ""])) as T])}>
        <Plus className="h-4 w-4" aria-hidden /> {addLabel}
      </Button>
    </div>
  );
}

const PRICING_LABEL: Record<PricingModel, string> = { fixed: "Fixed price", from: "Starting from", monthly: "Monthly", quote: "Custom quote (no amount)" };
const ENGAGEMENT = [
  ["project", "Task-based", "A defined project or task at an agreed price."],
  ["monthly", "Monthly service", "Ongoing work for a fixed monthly fee."],
  ["growth", "Growth partnership", "Selective, by discussion — shown separately, never as a payment plan."],
] as const;
const SECTIONS = [
  ["basic", "Basic information"],
  ["description", "Description"],
  ["pricing", "Pricing"],
  ["discount", "Discount"],
  ["engagement", "Engagement options"],
  ["landing", "Landing page"],
  ["seo", "SEO"],
  ["visibility", "Visibility"],
] as const;

/* ───────────── Editor ───────────── */

/** Service editor (Service Management). Saving publishes the change to the website immediately. */
export function ServiceEditor({ base, initial, options }: { base: string; initial?: ServiceRecord; options: ServiceEditorOptions }) {
  const router = useRouter();
  const toast = useToast();
  const r = (initial ?? {}) as Loose;
  const pricing0 = (r.pricing ?? {}) as Loose;
  const discount0 = (r.discount ?? {}) as Loose;
  const translations0 = (r.translations ?? {}) as Record<string, Loose>;

  const [lang, setLang] = useState("en");
  const [content, setContent] = useState<Record<string, LocalizedForm>>(() => {
    const out: Record<string, LocalizedForm> = { en: initial ? localizedFrom(r, true) : emptyLocalized() };
    for (const l of options.languages) if (l.code !== "en") out[l.code] = translations0[l.code] ? localizedFrom(translations0[l.code]!, false) : emptyLocalized();
    return out;
  });
  const [slug, setSlug] = useState(s(r.slug));
  const [slugTouched, setSlugTouched] = useState(!!initial);
  const [category, setCategory] = useState(s(r.category));
  const [icon, setIcon] = useState(s(r.icon) || "MonitorSmartphone");
  const [presentation, setPresentation] = useState(s(r.presentation) || "card");
  const [active, setActive] = useState(initial ? !!r.active : false);
  const [featured, setFeatured] = useState(!!r.featured);
  const [displayOrder, setDisplayOrder] = useState(typeof r.displayOrder === "number" ? String(r.displayOrder) : "");
  const [model, setModel] = useState<PricingModel>((s(pricing0.model) as PricingModel) || "quote");
  const [amount, setAmount] = useState(typeof pricing0.amount === "number" ? String(pricing0.amount) : "");
  const [currency, setCurrency] = useState(s(pricing0.currency) || "NOK");
  const [discountOn, setDiscountOn] = useState(!!discount0.enabled);
  const [discountType, setDiscountType] = useState(s(discount0.type) || "percent");
  const [discountValue, setDiscountValue] = useState(typeof discount0.value === "number" ? String(discount0.value) : "");
  const [startsAt, setStartsAt] = useState(day(discount0.startsAt));
  const [endsAt, setEndsAt] = useState(day(discount0.endsAt));
  const [engagement, setEngagement] = useState<string[]>(Array.isArray(r.engagementOptions) ? (r.engagementOptions as string[]) : ["project", "monthly"]);
  const [ctaHref, setCtaHref] = useState(s((r.cta as Loose | undefined)?.href));
  const [contactNeed, setContactNeed] = useState(s(r.contactNeed) || "notSure");
  const [related, setRelated] = useState<string[]>(Array.isArray(r.related) ? (r.related as string[]) : []);
  const [portfolio, setPortfolio] = useState<string[]>(Array.isArray(r.portfolioServices) ? (r.portfolioServices as string[]) : []);
  const [noindex, setNoindex] = useState(!!(r.seo as Loose | undefined)?.noindex);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);

  const c = content[lang]!;
  const isBase = lang === "en";
  const baseText = content.en!;
  const setC = (patch: Partial<LocalizedForm>) => setContent((all) => ({ ...all, [lang]: { ...all[lang]!, ...patch } }));
  const setL = (patch: Partial<LandingForm>) => setC({ landing: { ...c.landing, ...patch } });
  /** Placeholder in a translation: the English base text it falls back to. */
  const ph = (v: string) => (isBase ? undefined : v ? `English: ${v.slice(0, 90)}${v.length > 90 ? "…" : ""}` : undefined);

  const amountNum = amount.trim() === "" ? null : Number(amount);
  const discountNum = discountValue.trim() === "" ? null : Number(discountValue);
  const preview = useMemo(
    () => priceDisplay({ model, amount: amountNum, currency }, discountOn ? { enabled: true, type: discountType as "percent" | "fixed", value: discountNum, label: baseText.discountLabel, startsAt: startsAt || null, endsAt: endsAt || null } : null, EN_PRICE_LABELS, "en"),
    [model, amountNum, currency, discountOn, discountType, discountNum, baseText.discountLabel, startsAt, endsAt],
  );

  function onName(v: string) {
    setC({ name: v });
    if (isBase && !slugTouched)
      setSlug(
        v
          .toLowerCase()
          .normalize("NFKD")
          .replace(/[̀-ͯ]/g, "")
          .replace(/æ/g, "ae")
          .replace(/ø/g, "o")
          .replace(/å/g, "a")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 80),
      );
  }

  function payload() {
    const b = content.en!;
    const translations: Record<string, unknown> = {};
    for (const [code, t] of Object.entries(content)) {
      if (code === "en") continue;
      if (!hasContent(t) && !translations0[code]) continue;
      translations[code] = { name: t.name, shortTitle: t.shortTitle, shortDescription: t.shortDescription, description: t.description, ctaLabel: t.ctaLabel, pricingNote: t.pricingNote, discountLabel: t.discountLabel, landing: landingOut(t.landing), seo: { title: t.seoTitle, description: t.seoDescription } };
    }
    return {
      slug,
      name: b.name,
      shortTitle: b.shortTitle,
      shortDescription: b.shortDescription,
      description: b.description,
      category,
      icon,
      presentation,
      active,
      featured: active && featured,
      ...(displayOrder.trim() && { displayOrder: Number(displayOrder) }),
      pricing: { model, amount: model === "quote" ? null : amountNum, currency, note: b.pricingNote },
      discount: discountOn ? { enabled: true, type: discountType, value: discountNum ?? 0, label: b.discountLabel, startsAt: startsAt || null, endsAt: endsAt || null } : null,
      engagementOptions: engagement,
      cta: { label: b.ctaLabel, href: ctaHref },
      contactNeed,
      landing: landingOut(b.landing),
      related,
      portfolioServices: portfolio,
      seo: { title: b.seoTitle, description: b.seoDescription, noindex },
      translations,
    };
  }

  async function save() {
    setSaving(true);
    setErrors({});
    setError(null);
    try {
      if (initial?._id) {
        await apiFetch(`/api/services/${initial._id}`, { method: "PATCH", body: payload() });
        toast.success(active ? "Saved and published" : "Saved (inactive — not shown on the website)");
        router.refresh();
      } else {
        const created = await apiFetch<{ id: string }>("/api/services", { body: payload() });
        toast.success(active ? "Service created and published" : "Service created as a draft");
        router.push(`${base}/service-management/${created.id}`);
      }
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors ?? {});
        setError(e.message);
      } else setError("Something went wrong — nothing was saved.");
    } finally {
      setSaving(false);
    }
  }

  const err = (k: string) => errors[k];
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="grid gap-6 xl:grid-cols-[13rem_minmax(0,1fr)]">
      <nav aria-label="Editor sections" className="hidden xl:block">
        <ul className="sticky top-20 space-y-1 text-sm">
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="block rounded-lg px-3 py-1.5 text-ink-600 hover:bg-ink-100 hover:text-ink-900">
                {label}
              </a>
            </li>
          ))}
          <li>
            <a href="#preview" className="block rounded-lg px-3 py-1.5 text-ink-600 hover:bg-ink-100 hover:text-ink-900">
              Preview
            </a>
          </li>
        </ul>
      </nav>

      <div className="min-w-0 space-y-5">
        <div className="sticky top-16 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-200 bg-white/95 px-4 py-3 shadow-soft backdrop-blur">
          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Content language">
            {options.languages.map((l) => (
              <button
                key={l.code}
                type="button"
                role="tab"
                aria-selected={lang === l.code}
                onClick={() => setLang(l.code)}
                className={cn("rounded-lg px-2.5 py-1 text-xs font-semibold uppercase", lang === l.code ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-100", l.code !== "en" && hasContent(content[l.code]!) && lang !== l.code && "ring-1 ring-brand-300")}
                title={l.name}
              >
                {l.code}
              </button>
            ))}
            <span className="text-xs text-ink-500">{isBase ? "English is the base text." : "Translation — empty fields use the English text."}</span>
          </div>
          <Button onClick={save} loading={saving}>
            <Save className="h-4 w-4" aria-hidden /> Save
          </Button>
        </div>

        {error && (
          <Alert tone="danger" title="Not saved">
            {error}
          </Alert>
        )}

        <Section id="basic" title="Basic information">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Service name" error={isBase ? err("name") : undefined}>
              {(p) => <Input {...p} value={c.name} onChange={(e) => onName(e.target.value)} placeholder={ph(baseText.name) ?? "Website Development"} />}
            </Field>
            <Field label="Short title" optional="optional" hint="Used on cards and in the footer.">
              {(p) => <Input {...p} value={c.shortTitle} onChange={(e) => setC({ shortTitle: e.target.value })} placeholder={ph(baseText.shortTitle)} />}
            </Field>
          </div>
          {isBase && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Page address" error={err("slug")} hint={`exploretechify.com/services/${slug || "…"}`}>
                {(p) => (
                  <Input
                    {...p}
                    value={slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setSlug(e.target.value.toLowerCase());
                    }}
                    placeholder="web-development"
                  />
                )}
              </Field>
              <Field label="Category" optional="optional" hint="For your own grouping.">
                {(p) => <Input {...p} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Website, Systems, People…" />}
              </Field>
              <Field label="Icon">
                {(p) => (
                  <Select {...p} value={icon} onChange={(e) => setIcon(e.target.value)}>
                    {options.icons.map((i) => (
                      <option key={i} value={i}>
                        {i.replace(/([a-z])([A-Z])/g, "$1 $2")}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          )}
          {isBase && initial && slug !== s(r.slug) && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Changing the address changes the page URL — links and emails that use the old address will stop working.</p>}
        </Section>

        <Section id="description" title="Service description">
          <Field label="Short description" optional="optional" hint="One or two lines for cards and search results.">
            {(p) => <Textarea {...p} rows={2} value={c.shortDescription} onChange={(e) => setC({ shortDescription: e.target.value })} placeholder={ph(baseText.shortDescription)} />}
          </Field>
          <Field label="Full description" optional="optional" hint="Plain text, shown on the landing page below the solution.">
            {(p) => <Textarea {...p} rows={4} value={c.description} onChange={(e) => setC({ description: e.target.value })} placeholder={ph(baseText.description)} />}
          </Field>
        </Section>

        <Section id="pricing" title="Pricing" description="Clear and honest: leave the amount empty if no price is approved yet — the page then explains how the price is agreed.">
          {isBase ? (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Price model" error={err("pricing")}>
                  {(p) => (
                    <Select {...p} value={model} onChange={(e) => setModel(e.target.value as PricingModel)}>
                      {PRICING_MODELS.map((m) => (
                        <option key={m} value={m}>
                          {PRICING_LABEL[m]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Amount" optional="optional" hint="Whole units, e.g. 15000">
                  {(p) => <Input {...p} type="number" min={0} step={1} inputMode="numeric" value={amount} disabled={model === "quote"} onChange={(e) => setAmount(e.target.value)} placeholder={model === "quote" ? "—" : "15000"} />}
                </Field>
                <Field label="Currency">
                  {(p) => (
                    <Select {...p} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                      {CURRENCIES.map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              <Field label="Delivery time" optional="optional" hint="e.g. “2–4 weeks”. Empty: “Timeline agreed in the offer”.">
                {(p) => <Input {...p} value={c.landing.delivery} onChange={(e) => setL({ delivery: e.target.value })} />}
              </Field>
            </>
          ) : (
            <Field label="Delivery time" optional="optional">
              {(p) => <Input {...p} value={c.landing.delivery} onChange={(e) => setL({ delivery: e.target.value })} placeholder={ph(baseText.landing.delivery)} />}
            </Field>
          )}
          <Field label="Price note" optional="optional" hint="e.g. “excl. VAT”">
            {(p) => <Input {...p} value={c.pricingNote} onChange={(e) => setC({ pricingNote: e.target.value })} placeholder={ph(baseText.pricingNote)} />}
          </Field>
          <p className="rounded-xl bg-ink-50 px-4 py-3 text-sm text-ink-700">
            Shown as: <strong>{preview.text}</strong>
            {preview.originalText && (
              <span className="text-ink-500">
                {" "}
                (regular <s>{preview.originalText}</s>, {preview.discountLabel})
              </span>
            )}
          </p>
        </Section>

        <Section id="discount" title="Discount" description="A professional offer, shown as the regular price with the offer price — never as a sale banner. Needs a published amount.">
          {isBase && (
            <>
              <Checkbox label="Discount active" checked={discountOn} onChange={(e) => setDiscountOn(e.target.checked)} disabled={model === "quote"} />
              {discountOn && (
                <div className="grid gap-4 sm:grid-cols-4">
                  <Field label="Type" error={err("discount")}>
                    {(p) => (
                      <Select {...p} value={discountType} onChange={(e) => setDiscountType(e.target.value)}>
                        {DISCOUNT_TYPES.map((x) => (
                          <option key={x} value={x}>
                            {x === "percent" ? "Percentage" : `Fixed amount (${currency})`}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label={discountType === "percent" ? "Percent" : "Amount"}>
                    {(p) => <Input {...p} type="number" min={0} step={1} value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} placeholder={discountType === "percent" ? "20" : "2000"} />}
                  </Field>
                  <Field label="Starts" optional="optional">
                    {(p) => <Input {...p} type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />}
                  </Field>
                  <Field label="Ends" optional="optional">
                    {(p) => <Input {...p} type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />}
                  </Field>
                </div>
              )}
            </>
          )}
          <Field label="Discount label" optional="optional" hint="e.g. “Introductory offer” — shown next to the discount.">
            {(p) => <Input {...p} value={c.discountLabel} onChange={(e) => setC({ discountLabel: e.target.value })} placeholder={ph(baseText.discountLabel)} />}
          </Field>
        </Section>

        <Section id="engagement" title="Engagement options" description="How a client can work with you on this service — separate from the service price.">
          {isBase ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {ENGAGEMENT.map(([key, label, text]) => (
                <label key={key} className={cn("flex cursor-pointer gap-3 rounded-xl border p-3 text-sm", engagement.includes(key) ? "border-brand-300 bg-brand-50/60" : "border-ink-200")}>
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={engagement.includes(key)} onChange={() => setEngagement((e) => toggle(e, key))} />
                  <span>
                    <span className="block font-medium text-ink-900">{label}</span>
                    <span className="mt-0.5 block text-xs text-ink-500">{text}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-500">Engagement options apply to every language. Their wording is edited in Settings → Languages.</p>
          )}
        </Section>

        <Section id="landing" title="Landing page" description="One service, one page. Lists: one item per line. Empty sections are not shown.">
          <Field label="Headline" optional="optional" hint="Empty: the service name.">
            {(p) => <Input {...p} value={c.landing.heroTitle} onChange={(e) => setL({ heroTitle: e.target.value })} placeholder={ph(baseText.landing.heroTitle)} />}
          </Field>
          <Field label="Introduction" optional="optional">
            {(p) => <Textarea {...p} rows={2} value={c.landing.heroSubtitle} onChange={(e) => setL({ heroSubtitle: e.target.value })} placeholder={ph(baseText.landing.heroSubtitle)} />}
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Who it is for" optional="optional">
              {(p) => <Textarea {...p} rows={4} value={c.landing.whoFor} onChange={(e) => setL({ whoFor: e.target.value })} placeholder={ph(baseText.landing.whoFor) ?? "Small businesses without a website\nStartups preparing their launch"} />}
            </Field>
            <Field label="The problem it solves" optional="optional">
              {(p) => <Textarea {...p} rows={4} value={c.landing.problem} onChange={(e) => setL({ problem: e.target.value })} placeholder={ph(baseText.landing.problem)} />}
            </Field>
          </div>
          <Field label="What ExploreTechify does (the solution)" optional="optional">
            {(p) => <Textarea {...p} rows={3} value={c.landing.solution} onChange={(e) => setL({ solution: e.target.value })} placeholder={ph(baseText.landing.solution)} />}
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="What is included" optional="optional">
              {(p) => <Textarea {...p} rows={5} value={c.landing.included} onChange={(e) => setL({ included: e.target.value })} placeholder={ph(baseText.landing.included)} />}
            </Field>
            <Field label="What the client receives" optional="optional">
              {(p) => <Textarea {...p} rows={5} value={c.landing.deliverables} onChange={(e) => setL({ deliverables: e.target.value })} placeholder={ph(baseText.landing.deliverables)} />}
            </Field>
            <Field label="Not included" optional="optional">
              {(p) => <Textarea {...p} rows={3} value={c.landing.notIncluded} onChange={(e) => setL({ notIncluded: e.target.value })} placeholder={ph(baseText.landing.notIncluded)} />}
            </Field>
            <Field label="Optional additions" optional="optional">
              {(p) => <Textarea {...p} rows={3} value={c.landing.optional} onChange={(e) => setL({ optional: e.target.value })} placeholder={ph(baseText.landing.optional)} />}
            </Field>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-ink-800">How it works (process steps)</p>
            <PairList items={c.landing.steps} onChange={(steps) => setL({ steps })} fields={[{ key: "title", label: "Step title" }, { key: "text", label: "What happens", long: true }]} addLabel="Add step" />
          </div>
          <Field label="After delivery (long-term support)" optional="optional">
            {(p) => <Textarea {...p} rows={2} value={c.landing.longTerm} onChange={(e) => setL({ longTerm: e.target.value })} placeholder={ph(baseText.landing.longTerm)} />}
          </Field>
          <div>
            <p className="mb-2 text-sm font-medium text-ink-800">Questions and answers</p>
            <PairList items={c.landing.faq} onChange={(faq) => setL({ faq })} fields={[{ key: "q", label: "Question" }, { key: "a", label: "Answer", long: true }]} addLabel="Add question" />
          </div>
          <Field label="What happens next" optional="optional" hint="Empty: the standard “Tell us briefly about your business…” text.">
            {(p) => <Textarea {...p} rows={2} value={c.landing.nextStep} onChange={(e) => setL({ nextStep: e.target.value })} placeholder={ph(baseText.landing.nextStep)} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Button text" optional="optional" hint="Empty: “Request an Offer”. e.g. Get Started, Book a Consultation">
              {(p) => <Input {...p} value={c.ctaLabel} onChange={(e) => setC({ ctaLabel: e.target.value })} placeholder={ph(baseText.ctaLabel)} />}
            </Field>
            {isBase && (
              <Field label="Button destination" optional="optional" error={err("cta")} hint="Empty: the contact form with this service preselected. Or /contact, #pricing, https://…">
                {(p) => <Input {...p} value={ctaHref} onChange={(e) => setCtaHref(e.target.value)} placeholder="/contact" />}
              </Field>
            )}
          </div>
          {isBase && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Contact form: preselected need">
                {(p) => (
                  <Select {...p} value={contactNeed} onChange={(e) => setContactNeed(e.target.value)}>
                    {options.needs.map((n) => (
                      <option key={n.key} value={n.key}>
                        {n.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Presentation">
                {(p) => (
                  <Select {...p} value={presentation} onChange={(e) => setPresentation(e.target.value)}>
                    <option value="card">Card (regular service)</option>
                    <option value="wide">Wide band (long-term partner offer)</option>
                  </Select>
                )}
              </Field>
            </div>
          )}
          {isBase && (
            <div className="grid gap-4 md:grid-cols-2">
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-ink-800">Related services (shown at the bottom, max 6)</legend>
                <div className="scroll-thin max-h-48 space-y-1 overflow-y-auto rounded-xl border border-ink-200 p-2">
                  {options.services.filter((x) => x.slug !== slug).map((x) => (
                    <Checkbox key={x.slug} label={x.name} checked={related.includes(x.slug)} disabled={!related.includes(x.slug) && related.length >= 6} onChange={() => setRelated((v) => toggle(v, x.slug))} />
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-ink-800">Portfolio: show published case studies that used…</legend>
                <div className="scroll-thin max-h-48 space-y-1 overflow-y-auto rounded-xl border border-ink-200 p-2">
                  {options.serviceItems.map((x) => (
                    <Checkbox key={x.key} label={x.label} checked={portfolio.includes(x.key)} disabled={!portfolio.includes(x.key) && portfolio.length >= 12} onChange={() => setPortfolio((v) => toggle(v, x.key))} />
                  ))}
                </div>
              </fieldset>
            </div>
          )}
        </Section>

        <Section id="seo" title="SEO" description="Search title and description. Empty: the service name and short description.">
          <Field label="SEO title" optional="optional" hint={`${c.seoTitle.length}/70`}>
            {(p) => <Input {...p} maxLength={70} value={c.seoTitle} onChange={(e) => setC({ seoTitle: e.target.value })} placeholder={ph(baseText.seoTitle)} />}
          </Field>
          <Field label="Meta description" optional="optional" hint={`${c.seoDescription.length}/170`}>
            {(p) => <Textarea {...p} rows={2} maxLength={170} value={c.seoDescription} onChange={(e) => setC({ seoDescription: e.target.value })} placeholder={ph(baseText.seoDescription)} />}
          </Field>
          {isBase && <Checkbox label="Hide this page from search engines (noindex)" checked={noindex} onChange={(e) => setNoindex(e.target.checked)} />}
        </Section>

        <Section id="visibility" title="Visibility" description="Inactive services are hidden from the website but kept here.">
          <div className="flex flex-wrap gap-6">
            <Checkbox label="Active — shown on the website" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <Checkbox label="Featured on the homepage" checked={featured && active} disabled={!active} onChange={(e) => setFeatured(e.target.checked)} />
          </div>
          <Field label="Display order" optional="optional" hint="Lower numbers first. You can also reorder in the list.">
            {(p) => <Input {...p} type="number" min={0} step={1} className="sm:w-40" value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} />}
          </Field>
        </Section>

        <section id="preview" className="scroll-mt-24 rounded-2xl border border-dashed border-ink-300 bg-ink-50/60 p-5 sm:p-6">
          <h2 className="text-base font-semibold text-ink-900">Preview</h2>
          {initial?._id ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-ink-600">
              <span>Shows the saved version — save first to see your latest changes.</span>
              {options.languages.slice(0, 2).map((l) => (
                <a key={l.code} href={`${l.code === "en" ? "" : `/${l.code}`}/services/${s(r.slug)}/preview`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:text-brand-800">
                  Preview service page ({l.name}) <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink-600">Save the service (it starts inactive) to preview its page before publishing.</p>
          )}
        </section>

        <div className="flex justify-end">
          <Button onClick={save} loading={saving} size="lg">
            <Save className="h-4 w-4" aria-hidden /> Save
          </Button>
        </div>
      </div>
    </div>
  );
}
