import { Schema, type InferSchemaType } from "mongoose";
import { CONTACT_OWNERSHIP, CONTACT_PURPOSES, CONTACT_SOURCE_KINDS, EMAIL_VERIFICATION, PHONE_VERIFICATION, REVIEW_STATES } from "@/lib/company-fields";
import { defineModel, ObjectId, type Id } from "./_helpers";

export const CONTACT_TYPES = ["EMAIL", "PHONE", "MOBILE", "WEBSITE", "CONTACT_PERSON", "CONTACT_FORM"] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

/**
 * One attributable contact value for a company (provenance store).
 *
 * Separate assessments are kept for:
 *  - ownership     — does it belong to this legal entity (vs an intermediary / group)?
 *  - verification  — technical validity (email deliverability / phone status)
 *  - recency       — collectedAt / lastSeenAt
 *  - relevance     — purpose (general vs no-reply / invoice-only …) and usability
 * Registry, website and enrichment values are never presented as equally authoritative.
 */
const evidenceSchema = new Schema({ kind: String, detail: String, url: String, at: Date }, { _id: false });

const contactSchema = new Schema(
  {
    companyId: { type: ObjectId, ref: "Company", required: true, index: true },
    countryCode: { type: String, required: true, uppercase: true, index: true },
    type: { type: String, enum: CONTACT_TYPES, required: true },
    value: { type: String, required: true, trim: true },
    /** For CONTACT_PERSON (or a named email): professional role, e.g. "Daglig leder". */
    role: String,
    personName: String,

    sourceKind: { type: String, enum: CONTACT_SOURCE_KINDS, required: true },
    source: { type: String, required: true },
    sourceUrl: String,
    /** Provider id for enrichment values (hunter, apollo, brave, website …). */
    provider: String,
    collectedAt: { type: Date, default: Date.now },
    lastSeenAt: Date,

    ownership: { type: String, enum: CONTACT_OWNERSHIP, default: "CONFIRMED" },
    emailVerification: { type: String, enum: EMAIL_VERIFICATION },
    phoneVerification: { type: String, enum: PHONE_VERIFICATION },
    purpose: { type: String, enum: CONTACT_PURPOSES, default: "GENERAL" },
    /** Counts as a direct contact channel (computed from the assessments above). */
    usable: { type: Boolean, default: true },
    unusableReason: String,
    review: { type: String, enum: REVIEW_STATES, default: "NONE" },
    reviewNote: String,
    reviewedBy: { type: ObjectId, ref: "User" },
    reviewedAt: Date,
    evidence: { type: [evidenceSchema], default: [] },
    providerConfidence: Number,

    // Legacy single flag kept for older records / UI badges.
    verified: { type: Boolean, default: false },
    verifiedAt: Date,
    verificationMethod: String,
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

contactSchema.index({ companyId: 1, type: 1, value: 1 }, { unique: true });
contactSchema.index({ type: 1, value: 1 });
contactSchema.index({ countryCode: 1, createdAt: -1 });
contactSchema.index({ review: 1, createdAt: -1 });

export type ContactDoc = InferSchemaType<typeof contactSchema> & { _id: Id; createdAt: Date; updatedAt: Date };
export const Contact = defineModel("Contact", contactSchema);
