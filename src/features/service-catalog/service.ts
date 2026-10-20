import "server-only";
import { cache } from "react";
import { Types } from "mongoose";
import { z } from "zod";
import { LANGUAGE_CODES } from "@/config/languages";
import { SERVICE_ITEM_KEYS } from "@/config/services";
import { audit } from "@/lib/audit";
import { connectToDatabase, isDatabaseConfigured } from "@/lib/db/connect";
import { Errors } from "@/lib/errors";
import { getBaseMessages } from "@/lib/i18n/dictionaries";
import { createTranslator } from "@/lib/i18n/translator";
import { can, isOwner, type Actor } from "@/lib/permissions";
import { CURRENCIES, DISCOUNT_TYPES, PRICING_MODELS } from "@/lib/service-pricing";
import { parseObjectId } from "@/lib/validation";
import { CONTACT_NEEDS, ContactRequest, ENGAGEMENT_OPTIONS, SERVICE_ICONS, SERVICE_PRESENTATIONS, Service, SystemSetting, type ServiceDoc } from "@/models";
import { defaultServiceViews, serviceToView, sortServices, type ServiceView } from "./view";

/**
 * Service Management (public service catalogue).
 *
 * Authorization (server-side, on every call):
 *  - `services.manage` — create, edit, price, discount, (de)activate, feature, reorder, trash/restore.
 *    OWNER always; ADMIN by default; STAFF only when the Owner grants it.
 *  - Permanent deletion — OWNER only, with the slug typed as confirmation, and refused while
 *    enquiries reference the service (deactivate it instead, history stays intact).
 * Public reads expose active, non-deleted services and public fields only.
 * Text is plain text (rendered escaped); no HTML is accepted or stored.
 */

export const SEED_MIGRATION_ID = "2026-10-service-catalogue-v1";

/* ───────────── Validation ───────────── */

// Plain text: control characters removed, trimmed, bounded.
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
const text = (max: number) => z.string().max(max * 2).transform(clean).pipe(z.string().max(max));
const optText = (max: number) =>
  z
    .union([text(max), z.null()])
    .optional()
    .transform((v) => v || undefined);
const textList = (max: number, n = 20) =>
  z
    .array(z.string().max(max * 2))
    .max(n)
    .transform((a) => a.map(clean).filter(Boolean))
    .pipe(z.array(z.string().max(max)));

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Use at least 2 characters")
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lowercase letters, numbers and single dashes, e.g. web-development");

/** CTA target: a site path ("/contact?need=website"), an anchor ("#pricing") or an https URL. */
const hrefSchema = z
  .string()
  .trim()
  .max(300)
  .refine((v) => /^\/(?!\/)[^\s<>"']*$/.test(v) || /^#[A-Za-z0-9_-]+$/.test(v) || /^https:\/\/[^\s<>"']+$/.test(v), "Use a path starting with /, an #anchor or an https:// address");

const stepSchema = z.object({ title: text(80), text: optText(300).transform((v) => v ?? "") });
const faqSchema = z.object({ q: text(200), a: text(1200) });

const landingSchema = z.object({
  heroTitle: optText(160),
  heroSubtitle: optText(400),
  whoFor: textList(200, 10).optional(),
  problem: textList(300, 10).optional(),
  solution: optText(1500),
  included: textList(200, 20).optional(),
  steps: z.array(stepSchema).max(8).optional(),
  deliverables: textList(200, 20).optional(),
  notIncluded: textList(200, 12).optional(),
  optional: textList(200, 12).optional(),
  delivery: optText(120),
  longTerm: optText(800),
  nextStep: optText(400),
  faq: z.array(faqSchema).max(12).optional(),
});

const translationSchema = z.object({
  name: optText(120),
  shortTitle: optText(80),
  shortDescription: optText(300),
  description: optText(4000),
  ctaLabel: optText(40),
  pricingNote: optText(160),
  discountLabel: optText(60),
  landing: landingSchema.optional(),
  seo: z.object({ title: optText(70), description: optText(170) }).optional(),
});

export const pricingSchema = z.object({
  model: z.enum(PRICING_MODELS),
  amount: z.number().min(0).max(100_000_000).nullable().optional(),
  currency: z.enum(CURRENCIES).default("NOK"),
  note: optText(160),
});

export const discountSchema = z
  .object({
    enabled: z.boolean(),
    type: z.enum(DISCOUNT_TYPES),
    value: z.number().positive("Enter a discount above 0").max(100_000_000),
    label: optText(60),
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.type === "percent" && d.value > 90) ctx.addIssue({ code: "custom", path: ["value"], message: "A percentage discount must be 90% or less" });
    if (d.startsAt && d.endsAt && d.endsAt <= d.startsAt) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "The end date must be after the start date" });
  });

const baseFields = {
  name: text(120).pipe(z.string().min(2, "Add a service name")),
  shortTitle: optText(80),
  shortDescription: optText(300),
  description: optText(4000),
  category: optText(60),
  icon: z.enum(SERVICE_ICONS).optional(),
  presentation: z.enum(SERVICE_PRESENTATIONS).optional(),
  active: z.boolean().optional(),
  featured: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(100_000).optional(),
  pricing: pricingSchema.optional(),
  discount: discountSchema.nullable().optional(),
  engagementOptions: z.array(z.enum(ENGAGEMENT_OPTIONS)).max(3).optional(),
  cta: z.object({ label: optText(40), href: z.union([hrefSchema, z.literal(""), z.null()]).optional().transform((v) => v || undefined) }).optional(),
  contactNeed: z.enum(CONTACT_NEEDS).optional(),
  landing: landingSchema.optional(),
  related: z.array(slugSchema).max(6).optional(),
  portfolioServices: z.array(z.string().refine((s) => SERVICE_ITEM_KEYS.includes(s), "Unknown service item")).max(12).optional(),
  seo: z.object({ title: optText(70), description: optText(170), noindex: z.boolean().optional() }).optional(),
  /** Per-language overrides; only the locales sent are replaced. */
  translations: z.record(z.string(), translationSchema).optional(),
};

export const createServiceSchema = z.object({ slug: slugSchema, ...baseFields });
export const updateServiceSchema = z.object({ slug: slugSchema.optional(), ...baseFields, name: baseFields.name.optional() });

/* ───────────── Helpers ───────────── */

function assertManage(actor: Actor | null): asserts actor is Actor {
  if (!actor) throw Errors.unauthorized();
  if (!can(actor, "services.manage")) throw Errors.forbidden("You don't have permission to manage services.");
}

/** Every public page that can show a service is re-rendered after a change. */
async function revalidatePublicPages() {
  try {
    const { revalidatePath } = await import("next/cache");
    revalidatePath("/[locale]", "layout");
    revalidatePath("/sitemap.xml");
  } catch {
    /* outside a Next.js request (tests, scripts): nothing cached to invalidate */
  }
}

function checkTranslations(t: Record<string, unknown> | undefined) {
  for (const locale of Object.keys(t ?? {})) {
    if (locale === "en" || !(LANGUAGE_CODES as string[]).includes(locale)) throw Errors.badRequest(`Unknown translation language "${locale}". English is the base text.`);
  }
}

/** A fixed discount must stay below the price; a discount needs a published amount. */
function checkPriceAndDiscount(pricing: { model?: string; amount?: number | null } | undefined, discount: { enabled?: boolean; type?: string; value?: number } | null | undefined) {
  if (!discount?.enabled) return;
  if (!pricing || pricing.model === "quote" || !(typeof pricing.amount === "number" && pricing.amount > 0)) throw Errors.badRequest("A discount needs a published price. Set the price amount first (custom-quote services cannot have a discount).", { fieldErrors: { discount: ["A discount needs a published price."] } });
  if (discount.type === "fixed" && typeof discount.value === "number" && discount.value >= pricing.amount) throw Errors.badRequest("A fixed discount must be lower than the price.", { fieldErrors: { "discount.value": ["Must be lower than the price."] } });
}

async function findLive(id: string) {
  const doc = await Service.findOne({ _id: parseObjectId(id) }).lean<ServiceDoc>();
  if (!doc) throw Errors.notFound("Service not found.");
  return doc;
}

async function assertSlugFree(slug: string, exceptId?: Types.ObjectId) {
  const clash = await Service.findOne({ slug, ...(exceptId && { _id: { $ne: exceptId } }) }).select("deletedAt").lean<{ deletedAt?: Date }>();
  if (clash) throw Errors.conflict(clash.deletedAt ? `The address /services/${slug} belongs to a service in the trash. Restore it or choose another address.` : `Another service already uses /services/${slug}.`, { fieldErrors: { slug: ["Already in use"] } });
}

/** The $set document for an update; translations are set per locale so others stay untouched. */
function toSet(data: z.infer<typeof updateServiceSchema>, actor: Actor) {
  const { translations, discount, ...rest } = data;
  const set: Record<string, unknown> = { updatedBy: new Types.ObjectId(actor.id) };
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) set[k] = v;
  if (discount !== undefined) set.discount = discount ?? { enabled: false };
  for (const [locale, tr] of Object.entries(translations ?? {})) set[`translations.${locale}`] = tr;
  return set;
}

export type AdminServiceRow = {
  id: string;
  slug: string;
  name: string;
  category?: string;
  active: boolean;
  featured: boolean;
  displayOrder: number;
  deleted: boolean;
  pricing: ServiceView["pricing"];
  discount: ServiceView["discount"];
  engagementOptions: string[];
  translations: string[];
  updatedAt: string;
};

function toRow(d: ServiceDoc): AdminServiceRow {
  const v = serviceToView(d as unknown as Record<string, unknown>, "en");
  const translations = d.translations instanceof Map ? [...d.translations.keys()] : Object.keys((d.translations as Record<string, unknown>) ?? {});
  return { id: String(d._id), slug: d.slug, name: d.name, category: d.category ?? undefined, active: !!d.active && !d.deletedAt, featured: !!d.featured, displayOrder: d.displayOrder ?? 100, deleted: !!d.deletedAt, pricing: v.pricing, discount: v.discount, engagementOptions: v.engagementOptions, translations, updatedAt: new Date(d.updatedAt).toISOString() };
}

/* ───────────── Owner / Admin ───────────── */

export async function listServicesAdmin(actor: Actor | null, opts: { trash?: boolean } = {}) {
  assertManage(actor);
  const all = await Service.find().sort({ displayOrder: 1, name: 1 }).lean<ServiceDoc[]>();
  const live = all.filter((s) => !s.deletedAt);
  const rows = (opts.trash ? all.filter((s) => s.deletedAt) : live).map(toRow);
  return {
    rows,
    summary: { total: live.length, active: live.filter((s) => s.active).length, featured: live.filter((s) => s.featured && s.active).length, inactive: live.filter((s) => !s.active).length, trash: all.length - live.length },
  };
}

/** The full record for the editor (base text and every translation). */
export async function getServiceAdmin(actor: Actor | null, id: string) {
  assertManage(actor);
  const d = await findLive(id);
  const translations = d.translations instanceof Map ? Object.fromEntries(d.translations) : ((d.translations as Record<string, unknown>) ?? {});
  return { ...d, _id: String(d._id), translations, createdBy: undefined, updatedBy: undefined };
}

export async function createService(actor: Actor | null, input: unknown) {
  assertManage(actor);
  const data = createServiceSchema.parse(input);
  checkTranslations(data.translations);
  checkPriceAndDiscount(data.pricing, data.discount);
  await assertSlugFree(data.slug);
  const max = await Service.findOne({ deletedAt: null }).sort({ displayOrder: -1 }).select("displayOrder").lean<{ displayOrder?: number }>();
  const { translations, discount, ...rest } = data;
  const doc = await Service.create({
    ...rest,
    discount: discount ?? { enabled: false },
    translations: translations ?? {},
    displayOrder: rest.displayOrder ?? (max?.displayOrder ?? 0) + 10,
    // New services start as drafts unless explicitly published.
    active: rest.active ?? false,
    createdBy: actor.id,
    updatedBy: actor.id,
  });
  await audit(actor, "service.created", { entityType: "Service", entityId: String(doc._id), metadata: { slug: doc.slug } });
  await revalidatePublicPages();
  return { id: String(doc._id), slug: doc.slug };
}

export async function updateService(actor: Actor | null, id: string, input: unknown) {
  assertManage(actor);
  const current = await findLive(id);
  if (current.deletedAt) throw Errors.badRequest("Restore this service from the trash before editing it.");
  const data = updateServiceSchema.parse(input);
  checkTranslations(data.translations);
  checkPriceAndDiscount((data.pricing ?? current.pricing ?? undefined) as { model?: string; amount?: number | null } | undefined, (data.discount === undefined ? current.discount : data.discount) as { enabled?: boolean; type?: string; value?: number } | null);
  if (data.slug && data.slug !== current.slug) await assertSlugFree(data.slug, current._id);
  await Service.updateOne({ _id: current._id }, { $set: toSet(data, actor) });
  await audit(actor, "service.updated", { entityType: "Service", entityId: id, metadata: { slug: data.slug ?? current.slug, fields: Object.keys(data) } });
  await revalidatePublicPages();
  return getServiceAdmin(actor, id);
}

/** Section updates (same validation and authorization as a full update). */
export async function updateServicePricing(actor: Actor | null, id: string, input: unknown) {
  return updateService(actor, id, { pricing: pricingSchema.parse((input as { pricing?: unknown })?.pricing ?? input) });
}
export async function updateServiceDiscount(actor: Actor | null, id: string, input: unknown) {
  const raw = (input as { discount?: unknown })?.discount;
  return updateService(actor, id, { discount: raw === null ? null : discountSchema.parse(raw ?? input) });
}
export async function updateServiceLanding(actor: Actor | null, id: string, input: unknown) {
  const q = z.object({ locale: z.string().default("en"), landing: landingSchema }).parse(input);
  if (q.locale === "en") return updateService(actor, id, { landing: q.landing });
  assertManage(actor);
  const current = await findLive(id);
  const tr = current.translations instanceof Map ? current.translations.get(q.locale) : (current.translations as Record<string, unknown> | undefined)?.[q.locale];
  return updateService(actor, id, { translations: { [q.locale]: { ...((tr as object) ?? {}), landing: q.landing } } });
}

export async function setServiceStatus(actor: Actor | null, id: string, input: unknown) {
  const { active } = z.object({ active: z.boolean() }).parse(input);
  return updateService(actor, id, { active, ...(!active && { featured: false }) });
}

/** New display order: the ids in the order the Owner arranged them. */
export async function reorderServices(actor: Actor | null, input: unknown) {
  assertManage(actor);
  const { ids } = z.object({ ids: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).min(1).max(500) }).parse(input);
  await Service.bulkWrite(ids.map((id, i) => ({ updateOne: { filter: { _id: new Types.ObjectId(id) }, update: { $set: { displayOrder: (i + 1) * 10, updatedBy: new Types.ObjectId(actor.id) } } } })));
  await audit(actor, "service.reordered", { entityType: "Service", metadata: { count: ids.length } });
  await revalidatePublicPages();
  return { ok: true };
}

/** Normal removal: hidden everywhere, kept in the database, restorable. */
export async function trashService(actor: Actor | null, id: string) {
  assertManage(actor);
  const current = await findLive(id);
  await Service.updateOne({ _id: current._id }, { $set: { deletedAt: new Date(), active: false, featured: false, updatedBy: new Types.ObjectId(actor.id) } });
  await audit(actor, "service.trashed", { entityType: "Service", entityId: id, metadata: { slug: current.slug } });
  await revalidatePublicPages();
  return { ok: true, trashed: true };
}

export async function restoreService(actor: Actor | null, id: string) {
  assertManage(actor);
  const current = await findLive(id);
  await Service.updateOne({ _id: current._id }, { $unset: { deletedAt: 1 }, $set: { updatedBy: new Types.ObjectId(actor.id) } });
  await audit(actor, "service.restored", { entityType: "Service", entityId: id, metadata: { slug: current.slug } });
  await revalidatePublicPages();
  return { ok: true };
}

/** OWNER only, typed confirmation, never while enquiries reference the service. */
export async function deleteServicePermanently(actor: Actor | null, id: string, input: unknown) {
  assertManage(actor);
  if (!isOwner(actor)) throw Errors.forbidden("Only the Owner can delete a service permanently. Deactivate it or move it to the trash instead.");
  const { confirmSlug } = z.object({ confirmSlug: z.string() }).parse(input);
  const current = await findLive(id);
  if (confirmSlug.trim().toLowerCase() !== current.slug) throw Errors.badRequest(`Type the service address "${current.slug}" to confirm permanent deletion.`, { code: "CONFIRMATION_MISMATCH" });
  const enquiries = await ContactRequest.countDocuments({ serviceSlug: current.slug });
  if (enquiries > 0) throw Errors.conflict(`${enquiries} enquir${enquiries === 1 ? "y refers" : "ies refer"} to this service. Keep it deactivated so the history stays intact.`, { code: "HAS_HISTORY" });
  await Service.deleteOne({ _id: current._id });
  await audit(actor, "service.deleted", { entityType: "Service", entityId: id, metadata: { slug: current.slug } });
  await revalidatePublicPages();
  return { ok: true, deleted: true };
}

/* ───────────── Public ───────────── */

/**
 * Whether the database holds the catalogue. Until the seed migration has run (or with no
 * database at all, e.g. during a build), the built-in services are shown so the site never
 * renders empty. Once seeded, only the Owner's records count — even if every service is off.
 */
async function catalogueSource(): Promise<"db" | "defaults"> {
  if (!isDatabaseConfigured()) return "defaults";
  try {
    await connectToDatabase();
    const [migrations, any] = await Promise.all([SystemSetting.findOne({ key: "__migrations" }).lean<{ value?: { done?: string[] } }>(), Service.exists({})]);
    return any || migrations?.value?.done?.includes(SEED_MIGRATION_ID) ? "db" : "defaults";
  } catch {
    return "defaults";
  }
}

const defaults = (locale: string) => defaultServiceViews(locale, createTranslator(getBaseMessages(locale)).raw);

/** Active services in display order, in one language (public fields only). */
export const listPublicServices = cache(async (locale: string): Promise<ServiceView[]> => {
  if ((await catalogueSource()) === "defaults") return sortServices(defaults(locale));
  try {
    const docs = await Service.find({ active: true, deletedAt: null }).sort({ displayOrder: 1, name: 1 }).lean<ServiceDoc[]>();
    return docs.map((d) => publicView(d, locale));
  } catch {
    return sortServices(defaults(locale));
  }
});

export async function getPublicService(slug: string, locale: string): Promise<ServiceView | null> {
  return (await listPublicServices(locale)).find((s) => s.slug === slug) ?? null;
}

/** Strip anything the public does not need (ids stay internal). */
function publicView(d: ServiceDoc, locale: string): ServiceView {
  const { id: _id, ...view } = serviceToView(d as unknown as Record<string, unknown>, locale);
  void _id;
  return view;
}

/** Preview for the editor: inactive services too (never trashed ones), only with services.manage. */
export async function getPreviewService(actor: Actor | null, slug: string, locale: string): Promise<ServiceView | null> {
  if (!actor || !can(actor, "services.manage")) return null;
  if ((await catalogueSource()) === "defaults") return defaults(locale).find((s) => s.slug === slug) ?? null;
  const d = await Service.findOne({ slug, deletedAt: null }).lean<ServiceDoc>();
  return d ? { ...serviceToView(d as unknown as Record<string, unknown>, locale), id: String(d._id) } : null;
}
