import { Schema, type InferSchemaType } from "mongoose";
import { SUPPRESSION_REASONS } from "@/lib/constants";
import { defineModel, ObjectId, type Id } from "./_helpers";

/** Addresses or whole domains that must never receive outreach. Checked before every send. */
const suppressionEntrySchema = new Schema(
  {
    email: { type: String, lowercase: true, trim: true },
    domain: { type: String, lowercase: true, trim: true },
    reason: { type: String, enum: SUPPRESSION_REASONS, required: true },
    source: { type: String, default: "manual" },
    note: String,
    createdBy: { type: ObjectId, ref: "User" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

suppressionEntrySchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: "string" } } });
suppressionEntrySchema.index({ domain: 1 }, { unique: true, partialFilterExpression: { domain: { $type: "string" } } });

export type SuppressionEntryDoc = InferSchemaType<typeof suppressionEntrySchema> & { _id: Id; createdAt: Date };
export const SuppressionEntry = defineModel("SuppressionEntry", suppressionEntrySchema);
