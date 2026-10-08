import { Schema, type InferSchemaType } from "mongoose";
import { defineModel, ObjectId, type Id } from "./_helpers";

/**
 * Owner-editable service package with targeting rules and approved pricing.
 * Rules only express evidence that must exist — they never assume a need.
 */
const lineItemSchema = new Schema({ description: String, quantity: { type: Number, default: 1 }, unitPrice: Number, unit: String }, { _id: false });

export const EVIDENCE_REQUIREMENTS = ["none", "website_found", "website_not_found_after_research", "weak_website_audit", "hiring_signal", "direct_contact", "webmail_email"] as const;
export type EvidenceRequirement = (typeof EVIDENCE_REQUIREMENTS)[number];

const servicePackageSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    group: String,
    description: String,
    deliverables: { type: [String], default: [] },
    timeline: String,
    currency: { type: String, default: "EUR" },
    /** Owner-approved price lines. Missing unitPrice = placeholder in quotations. */
    lineItems: { type: [lineItemSchema], default: [] },
    terms: String,
    active: { type: Boolean, default: true },
    rules: {
      countries: { type: [String], default: [] },
      languages: { type: [String], default: [] },
      industries: { type: [String], default: [] },
      maxCompanyAgeDays: Number,
      requireDirectContact: { type: Boolean, default: false },
      requiresEvidence: { type: String, enum: EVIDENCE_REQUIREMENTS, default: "none" },
      weight: { type: Number, default: 50 },
    },
    nextQuestion: String,
    updatedBy: { type: ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export type ServicePackageDoc = InferSchemaType<typeof servicePackageSchema> & { _id: Id };
export const ServicePackage = defineModel("ServicePackage", servicePackageSchema);
