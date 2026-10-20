import { Schema, type InferSchemaType } from "mongoose";
import { CURRENCIES, DISCOUNT_TYPES, PRICING_MODELS } from "@/lib/service-pricing";
import { defineModel, ObjectId, type Id } from "./_helpers";

/**
 * Public service catalogue (Service Management): one record per service the website
 * offers, each with its own landing page at /services/<slug>.
 *
 * Text fields hold the BASE (English) content; `translations.<locale>` holds optional
 * per-language overrides of the same text fields — missing translations fall back to
 * the base text, so a service is never duplicated per language.
 *
 * Separate from ServicePackage (internal quotation / service-fit packages) and
 * ClientService (services a client organisation uses).
 *
 * Deletion: `deletedAt` marks a service as in the trash (hidden everywhere, restorable).
 * Permanent deletion is an explicit Owner action.
 */
export const SERVICE_ICONS = ["MonitorSmartphone", "Network", "Contact", "Search", "Palette", "Megaphone", "Database", "Users", "Workflow", "RefreshCw", "Globe", "LayoutDashboard", "TrendingUp", "Boxes", "Headphones", "Briefcase", "ShoppingCart", "LineChart"] as const;
export const SERVICE_PRESENTATIONS = ["card", "wide"] as const;
/** How a client can engage (the existing engagement models). Growth partnership is never a price plan. */
export const ENGAGEMENT_OPTIONS = ["monthly", "project", "growth"] as const;
/** Preselected "What do you need?" in the contact form. */
export const CONTACT_NEEDS = ["website", "ongoing", "systems", "growth", "recruitment", "automation", "notSure"] as const;

const pairSchema = new Schema({ title: String, text: String }, { _id: false });
const faqSchema = new Schema({ q: String, a: String }, { _id: false });

/** Every translatable text of a service (base content and each translation use the same shape). */
const landingFields = {
  heroTitle: String,
  heroSubtitle: String,
  whoFor: { type: [String], default: undefined },
  problem: { type: [String], default: undefined },
  solution: String,
  included: { type: [String], default: undefined },
  steps: { type: [pairSchema], default: undefined },
  deliverables: { type: [String], default: undefined },
  notIncluded: { type: [String], default: undefined },
  optional: { type: [String], default: undefined },
  delivery: String,
  longTerm: String,
  nextStep: String,
  faq: { type: [faqSchema], default: undefined },
};
const landingSchema = new Schema(landingFields, { _id: false });

const translationSchema = new Schema(
  {
    name: String,
    shortTitle: String,
    shortDescription: String,
    description: String,
    ctaLabel: String,
    pricingNote: String,
    discountLabel: String,
    landing: { type: landingSchema, default: undefined },
    seo: { type: new Schema({ title: String, description: String }, { _id: false }), default: undefined },
  },
  { _id: false },
);

const serviceSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    shortTitle: String,
    shortDescription: String,
    description: String,
    category: String,
    icon: { type: String, enum: SERVICE_ICONS, default: "MonitorSmartphone" },
    /** "wide": presented as the long-term partner band instead of a regular card. */
    presentation: { type: String, enum: SERVICE_PRESENTATIONS, default: "card" },

    active: { type: Boolean, default: false },
    featured: { type: Boolean, default: false },
    displayOrder: { type: Number, default: 100 },

    pricing: {
      model: { type: String, enum: PRICING_MODELS, default: "quote" },
      /** Whole currency units. Empty = no published amount (the page explains how the price is agreed). */
      amount: Number,
      currency: { type: String, enum: CURRENCIES, default: "NOK" },
      /** Optional short note under the price, e.g. "excl. VAT". */
      note: String,
    },
    discount: {
      enabled: { type: Boolean, default: false },
      type: { type: String, enum: DISCOUNT_TYPES },
      value: Number,
      label: String,
      startsAt: Date,
      endsAt: Date,
    },
    engagementOptions: { type: [String], enum: ENGAGEMENT_OPTIONS, default: ["project", "monthly"] },
    cta: { label: String, href: String },
    contactNeed: { type: String, enum: CONTACT_NEEDS, default: "notSure" },

    landing: { type: landingSchema, default: () => ({}) },
    /** Related services (slugs), shown at the bottom of the landing page. */
    related: { type: [String], default: [] },
    /** Case-study service keys whose published projects appear as examples. */
    portfolioServices: { type: [String], default: [] },
    seo: { title: String, description: String, noindex: { type: Boolean, default: false } },

    translations: { type: Map, of: translationSchema, default: {} },

    deletedAt: Date,
    createdBy: { type: ObjectId, ref: "User" },
    updatedBy: { type: ObjectId, ref: "User" },
  },
  { timestamps: true },
);

serviceSchema.index({ active: 1, deletedAt: 1, displayOrder: 1 });
serviceSchema.index({ featured: 1, active: 1, displayOrder: 1 });

export type ServiceDoc = InferSchemaType<typeof serviceSchema> & { _id: Id; createdAt: Date; updatedAt: Date };
export type ServiceLandingContent = InferSchemaType<typeof landingSchema>;
export type ServiceTranslation = InferSchemaType<typeof translationSchema>;
export const Service = defineModel("Service", serviceSchema);
