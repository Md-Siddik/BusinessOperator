import { Schema, type InferSchemaType } from "mongoose";
import { defineModel, ObjectId, type Id } from "./_helpers";

/**
 * Editable quotation draft for manual communication. Nothing is sent from the
 * system. Missing commercial inputs stay explicit placeholders (unitPrice null).
 */
export const QUOTATION_STATUSES = ["DRAFT", "READY", "SHARED_MANUALLY", "ACCEPTED", "DECLINED"] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

const quotationSchema = new Schema(
  {
    number: { type: Number, required: true, unique: true },
    companyId: { type: ObjectId, ref: "Company", required: true, index: true },
    countryCode: String,
    packageId: { type: ObjectId, ref: "ServicePackage" },
    title: { type: String, required: true },
    recipient: {
      contactId: { type: ObjectId, ref: "Contact" },
      name: String,
      email: String,
      phone: String,
    },
    currency: { type: String, default: "EUR" },
    items: { type: [{ description: String, quantity: Number, unitPrice: Number, unit: String, _id: false }], default: [] },
    deliverables: { type: [String], default: [] },
    timeline: String,
    terms: String,
    validUntil: Date,
    notes: String,
    status: { type: String, enum: QUOTATION_STATUSES, default: "DRAFT" },
    createdBy: { type: ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export type QuotationDoc = InferSchemaType<typeof quotationSchema> & { _id: Id; createdAt: Date; updatedAt: Date };
export const Quotation = defineModel("Quotation", quotationSchema);
