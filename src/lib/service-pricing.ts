/**
 * Service pricing and discounts (client-safe, pure). One implementation for the public
 * landing pages, the Service Management dashboard and outreach emails, so a price can never
 * be shown differently in two places.
 *
 * Price models: fixed ("15 000 kr"), from ("From 10 000 kr"), monthly ("5 000 kr / month"),
 * quote (no amount: "tailored quote"). A missing amount is never invented — the text then
 * says how the price is agreed.
 */
export const PRICING_MODELS = ["fixed", "from", "monthly", "quote"] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];

export const CURRENCIES = ["NOK", "EUR", "SEK", "DKK", "GBP", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const DISCOUNT_TYPES = ["percent", "fixed"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export type ServicePricing = { model: PricingModel; amount?: number | null; currency?: string | null };
export type ServiceDiscount = { enabled?: boolean | null; type?: DiscountType | null; value?: number | null; label?: string | null; startsAt?: Date | string | null; endsAt?: Date | string | null };

const LOCALE_TAGS: Record<string, string> = { en: "en-GB", no: "nb-NO", de: "de-DE", sv: "sv-SE", fi: "fi-FI", da: "da-DK", fr: "fr-FR" };

export function formatMoney(amount: number, currency: string, locale = "en") {
  try {
    return new Intl.NumberFormat(LOCALE_TAGS[locale] ?? "en-GB", { style: "currency", currency, maximumFractionDigits: amount % 1 === 0 ? 0 : 2 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** True when a price can be shown (a priced model with a positive amount). */
export function hasAmount(p: ServicePricing | null | undefined): p is ServicePricing & { amount: number } {
  return !!p && p.model !== "quote" && typeof p.amount === "number" && p.amount > 0;
}

/** Is the discount applicable right now (enabled, valid value, inside its optional date window)? */
export function discountActive(d: ServiceDiscount | null | undefined, p: ServicePricing | null | undefined, now = new Date()) {
  if (!d?.enabled || !hasAmount(p) || !d.type || !(typeof d.value === "number" && d.value > 0)) return false;
  if (d.type === "percent" && d.value >= 100) return false;
  if (d.type === "fixed" && d.value >= p.amount) return false;
  const t = now.getTime();
  if (d.startsAt && new Date(d.startsAt).getTime() > t) return false;
  if (d.endsAt && new Date(d.endsAt).getTime() < t) return false;
  return true;
}

/** Price after discount, rounded to whole currency units. */
export function discountedAmount(p: ServicePricing & { amount: number }, d: ServiceDiscount) {
  const v = d.value ?? 0;
  const out = d.type === "percent" ? p.amount * (1 - v / 100) : p.amount - v;
  return Math.max(0, Math.round(out));
}

export type PriceDisplay = {
  /** The price line as shown, e.g. "From 10 000 kr". */
  text: string;
  /** With an active discount: the original price line, shown struck through. */
  originalText?: string;
  /** "20% off" / "2 000 kr off" — or the Owner's own label. */
  discountLabel?: string;
  /** Discount end date, when set. */
  validUntil?: Date;
  hasPrice: boolean;
};

/**
 * Label templates come from the dictionaries ("Fixed price: {amount}", "From {amount}",
 * "{amount} per month", plus the no-amount texts), so every language reads naturally.
 */
export type PriceLabels = {
  fixed: string;
  from: string;
  monthly: string;
  quote: string;
  fixedOpen: string;
  fromOpen: string;
  monthlyOpen: string;
  quoteOpen: string;
  percentOff: string;
  amountOff: string;
};

const fill = (template: string, amount: string) => template.replace("{amount}", amount);

export function priceDisplay(p: ServicePricing | null | undefined, d: ServiceDiscount | null | undefined, labels: PriceLabels, locale = "en", now = new Date()): PriceDisplay {
  const model = p?.model ?? "quote";
  if (!hasAmount(p)) return { text: labels[`${model}Open` as keyof PriceLabels], hasPrice: false };
  const currency = p.currency || "NOK";
  const line = (amount: number) => fill(labels[model], formatMoney(amount, currency, locale));
  if (!discountActive(d, p, now)) return { text: line(p.amount), hasPrice: true };
  const off = d!.type === "percent" ? fill(labels.percentOff, `${d!.value}%`) : fill(labels.amountOff, formatMoney(d!.value!, currency, locale));
  return {
    text: line(discountedAmount(p, d!)),
    originalText: line(p.amount),
    discountLabel: d!.label?.trim() ? `${d!.label.trim()} · ${off}` : off,
    validUntil: d!.endsAt ? new Date(d!.endsAt) : undefined,
    hasPrice: true,
  };
}

/** Price labels in one language, from the dictionaries ("servicePages.ui.pricing.*"). */
export function priceLabelsFrom(t: (key: string, vars?: Record<string, string>) => string): PriceLabels {
  const k = "servicePages.ui.pricing";
  const keep = { amount: "{amount}" };
  return {
    fixed: t(`${k}.fixed`, keep),
    from: t(`${k}.from`, keep),
    monthly: t(`${k}.monthly`, keep),
    quote: t(`${k}.quote`, keep),
    fixedOpen: t(`${k}.fixedOpen`),
    fromOpen: t(`${k}.fromOpen`),
    monthlyOpen: t(`${k}.monthlyOpen`),
    quoteOpen: t(`${k}.quoteOpen`),
    percentOff: t(`${k}.percentOff`, keep),
    amountOff: t(`${k}.amountOff`, keep),
  };
}

/** English labels — used by the dashboard and as a fallback. */
export const EN_PRICE_LABELS: PriceLabels = {
  fixed: "Fixed price: {amount}",
  from: "From {amount}",
  monthly: "{amount} per month",
  quote: "From {amount}",
  fixedOpen: "Fixed price, agreed in writing before we start",
  fromOpen: "Priced by scope, confirmed in a written offer",
  monthlyOpen: "Fixed monthly fee for an agreed scope",
  quoteOpen: "Quoted per project after a short conversation",
  percentOff: "{amount} off",
  amountOff: "{amount} off",
};
