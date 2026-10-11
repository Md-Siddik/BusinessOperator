import { Schema, type InferSchemaType } from "mongoose";
import { CONTACT_REQUEST_STATUSES } from "@/lib/constants";
import { defineModel, ObjectId, type Id } from "./_helpers";

/** Public website enquiries (contact form). */
const contactRequestSchema = new Schema(
  {
    name: { type: String, required: true },
    company: String,
    email: { type: String, required: true, lowercase: true },
    phone: String,
    countryCode: String,
    industry: String,
    website: String,
    need: String,
    /** Preferred engagement model: monthly | growth | project | notSure. */
    engagement: String,
    message: { type: String, required: true, maxlength: 5000 },
    preferredContact: String,
    budget: String,
    ongoingSupport: String,
    interestedServices: { type: [String], default: [] },
    locale: String,
    status: { type: String, enum: CONTACT_REQUEST_STATUSES, default: "NEW" },
    assignedTo: { type: ObjectId, ref: "User" },
    notes: String,
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

contactRequestSchema.index({ status: 1, createdAt: -1 });

export type ContactRequestDoc = InferSchemaType<typeof contactRequestSchema> & { _id: Id; createdAt: Date };
export const ContactRequest = defineModel("ContactRequest", contactRequestSchema);
