import { z } from "zod";
import { INDUSTRIES } from "@/config/industries";
import { LANGUAGE_CODES } from "@/config/languages";
import { SERVICE_ITEM_KEYS } from "@/config/services";
import { CONTACT_REQUEST_STATUSES } from "@/lib/constants";
import { CaseStudy, ContactRequest, type CaseStudyDoc, type ContactRequestDoc } from "@/models";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { can, type Actor } from "@/lib/permissions";
import { emailSchema, isoCountrySchema, optionalPhone, optionalUrl, paginate, parseObjectId } from "@/lib/validation";
import { connectToDatabase, isDatabaseConfigured } from "@/lib/db/connect";
import { notifyInternal } from "@/features/notifications/service";

/* ───────────── Contact requests (public form) ───────────── */

/** How the visitor would like to work with us (homepage "three ways to work together"). */
export const ENGAGEMENT_MODELS = ["monthly", "growth", "project", "notSure"] as const;
export type EngagementModel = (typeof ENGAGEMENT_MODELS)[number];

export const contactRequestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  company: z.string().trim().max(200).optional(),
  email: emailSchema,
  phone: optionalPhone,
  country: isoCountrySchema.optional().or(z.literal("").transform(() => undefined)),
  industry: z.enum(INDUSTRIES).optional().or(z.literal("").transform(() => undefined)),
  website: optionalUrl,
  need: z.string().trim().max(60).optional(),
  engagement: z.enum(ENGAGEMENT_MODELS).optional().or(z.literal("").transform(() => undefined)),
  message: z.string().trim().min(10, "Please write a few words about what you need").max(5000),
  preferredContact: z.enum(["email", "phone", "video"]).optional().or(z.literal("").transform(() => undefined)),
  budget: z.string().max(40).optional(),
  ongoingSupport: z.enum(["yes", "no", "maybe"]).optional().or(z.literal("").transform(() => undefined)),
  interestedServices: z.array(z.string().refine((s) => SERVICE_ITEM_KEYS.includes(s))).max(20).default([]),
  locale: z.enum(LANGUAGE_CODES as [string, ...string[]]).default("en"),
  /** Honeypot — bots fill it, humans never see it. */
  website2: z.string().max(0).optional(),
});

export async function submitContactRequest(input: unknown) {
  const { country, website2: _hp, ...data } = contactRequestSchema.parse(input);
  void _hp;
  const doc = await ContactRequest.create({ ...data, countryCode: country });
  await notifyInternal("clients.manage", {
    type: "CLIENT_REQUEST",
    title: `New enquiry: ${data.company || data.name}`,
    body: data.message.slice(0, 140),
    link: `/dashboard/clients?tab=inquiries`,
  });
  await audit(null, "contact.submitted", { entityType: "ContactRequest", entityId: String(doc._id) });
  return { ok: true };
}

export async function listContactRequests(actor: Actor, opts: { status?: string; page?: number }) {
  if (!can(actor, "clients.manage")) throw Errors.forbidden();
  const page = opts.page ?? 1;
  const filter = opts.status ? { status: opts.status } : {};
  const [items, total] = await Promise.all([
    ContactRequest.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 25).limit(25).lean<ContactRequestDoc[]>(),
    ContactRequest.countDocuments(filter),
  ]);
  return paginate(items, total, page, 25);
}

export async function updateContactRequest(actor: Actor, id: string, input: unknown) {
  if (!can(actor, "clients.manage")) throw Errors.forbidden();
  const data = z.object({ status: z.enum(CONTACT_REQUEST_STATUSES), notes: z.string().max(2000).optional() }).parse(input);
  const res = await ContactRequest.updateOne({ _id: parseObjectId(id) }, { $set: data });
  if (!res.matchedCount) throw Errors.notFound();
}

/* ───────────── Case studies ───────────── */

const localizedSchema = z.object({
  title: z.string().trim().min(2).max(200),
  summary: z.string().trim().max(500).optional(),
  challenge: z.string().trim().max(3000).optional(),
  solution: z.string().trim().max(3000).optional(),
  results: z.array(z.string().trim().max(300)).max(10).optional(),
  testimonial: z.string().trim().max(1000).optional(),
});

export const caseStudySchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9-]{3,80}$/, "Lowercase letters, numbers and dashes"),
  clientName: z.string().trim().min(2).max(120),
  industry: z.enum(INDUSTRIES).optional(),
  countryCode: z.string().max(2).optional(),
  services: z.array(z.string()).max(20).default([]),
  technologies: z.array(z.string().max(60)).max(20).default([]),
  testimonialAuthor: z.string().max(120).optional(),
  content: localizedSchema,
  isExample: z.boolean().default(false),
  published: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

export type PublicCaseStudy = {
  slug: string;
  clientName: string;
  industry?: string | null;
  services: string[];
  technologies: string[];
  testimonialAuthor?: string | null;
  isExample: boolean;
  title: string;
  summary?: string | null;
  challenge?: string | null;
  solution?: string | null;
  results: string[];
  testimonial?: string | null;
};

function localize(cs: CaseStudyDoc, locale: string): PublicCaseStudy {
  const translations = cs.translations as unknown as Record<string, Partial<PublicCaseStudy>> | Map<string, Partial<PublicCaseStudy>> | undefined;
  const tr = translations instanceof Map ? translations.get(locale) : translations?.[locale];
  const base = cs.content;
  return {
    slug: cs.slug,
    clientName: cs.clientName,
    industry: cs.industry,
    services: cs.services,
    technologies: cs.technologies,
    testimonialAuthor: cs.testimonialAuthor,
    isExample: cs.isExample,
    title: tr?.title || base.title || cs.clientName,
    summary: tr?.summary || base.summary,
    challenge: tr?.challenge || base.challenge,
    solution: tr?.solution || base.solution,
    results: (tr?.results?.length ? tr.results : base.results) ?? [],
    testimonial: tr?.testimonial || base.testimonial,
  };
}

/** Public: published case studies (empty when the database is unavailable, e.g. during build). */
export async function listPublishedCaseStudies(locale: string): Promise<PublicCaseStudy[]> {
  if (!isDatabaseConfigured()) return [];
  try {
    await connectToDatabase();
    const items = await CaseStudy.find({ published: true }).sort({ sortOrder: 1, createdAt: -1 }).lean<CaseStudyDoc[]>();
    return items.map((c) => localize(c, locale));
  } catch {
    return [];
  }
}

export async function getPublishedCaseStudy(slug: string, locale: string) {
  if (!isDatabaseConfigured()) return null;
  await connectToDatabase();
  const cs = await CaseStudy.findOne({ slug, published: true }).lean<CaseStudyDoc>();
  return cs ? localize(cs, locale) : null;
}

export async function listCaseStudiesAdmin(actor: Actor) {
  if (!can(actor, "content.manage")) throw Errors.forbidden();
  return CaseStudy.find().sort({ sortOrder: 1, createdAt: -1 }).lean<CaseStudyDoc[]>();
}

export async function saveCaseStudy(actor: Actor, id: string | null, input: unknown) {
  if (!can(actor, "content.manage")) throw Errors.forbidden();
  const data = caseStudySchema.parse(input);
  const doc = id
    ? await CaseStudy.findByIdAndUpdate(parseObjectId(id), { $set: data }, { new: true }).lean<CaseStudyDoc>()
    : (await CaseStudy.create({ ...data, createdBy: actor.id })).toObject();
  if (!doc) throw Errors.notFound();
  await audit(actor, id ? "content.case_study_updated" : "content.case_study_created", { entityType: "CaseStudy", entityId: String(doc._id) });
  return doc;
}
