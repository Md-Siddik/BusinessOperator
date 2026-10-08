import { Schema, type InferSchemaType } from "mongoose";
import { defineModel, ObjectId, type Id } from "./_helpers";

/**
 * Outreach template. Country and language are independent:
 * countryCode "INTL" = any country; languageCode is the template language.
 */
const emailTemplateSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    subject: { type: String, required: true, maxlength: 300 },
    body: { type: String, required: true, maxlength: 20_000 },
    countryCode: { type: String, default: "INTL", uppercase: true },
    languageCode: { type: String, default: "en" },
    industry: String,
    serviceCategory: String,
    active: { type: Boolean, default: true },
    createdBy: { type: ObjectId, ref: "User" },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

emailTemplateSchema.index({ countryCode: 1, languageCode: 1 });

export type EmailTemplateDoc = InferSchemaType<typeof emailTemplateSchema> & { _id: Id; createdAt: Date; updatedAt: Date };
export const EmailTemplate = defineModel("EmailTemplate", emailTemplateSchema);
