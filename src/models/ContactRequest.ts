import { Schema, type InferSchemaType } from "mongoose";
import { CONTACT_REQUEST_STATUSES } from "@/lib/constants";
import { defineModel, ObjectId, type Id } from "./_helpers";

/** Public website enquiries (contact form). */
const contactRequestSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", index: true },
    emailVerifiedAt: Date,
    verificationTokenHash: { type: String, select: false },
    verificationExpiresAt: { type: Date, select: false },
    submissionKey: { type: String },
    timeline: String,
    responses: { type: [new Schema({
      authorId: { type: ObjectId, ref: "User", required: true },
      kind: { type: String, enum: ["REPLY", "QUOTATION", "CLIENT_REPLY"], required: true },
      body: { type: String, required: true, maxlength: 10000 },
      amount: Number,
      currency: String,
      scope: String,
      delivery: String,
      paymentTerms: String,
      notes: String,
      decision: { type: String, enum: ["PENDING", "ACCEPTED", "REJECTED"], default: "PENDING" },
      emailStatus: { type: String, enum: ["NOT_SENT", "ACCEPTED", "FAILED"], default: "NOT_SENT" },
    }, { timestamps: true })], default: [] },
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
    /** Landing page the visitor came from (/services/<slug>), when known. */
    serviceSlug: String,
    locale: String,
    status: { type: String, enum: CONTACT_REQUEST_STATUSES, default: "NEW" },
    assignedTo: { type: ObjectId, ref: "User" },
    notes: String,
    isDemo: { type: Boolean, default: false },
    /**
     * How this lead found the site — only when the visitor's browser accepted analytics. First touch
     * is their first recorded visit, last touch the visit that sent the enquiry. No identity data.
     */
    attribution: {
      type: new Schema(
        {
          conversionType: String,
          visitorLabel: String,
          firstTouch: { type: new Schema({ at: Date, channel: String, referrerDomain: String, campaign: String, source: String, medium: String, landingPage: String }, { _id: false }) },
          lastTouch: { type: new Schema({ at: Date, channel: String, referrerDomain: String, campaign: String, source: String, medium: String, landingPage: String }, { _id: false }) },
        },
        { _id: false },
      ),
    },
  },
  { timestamps: true },
);

contactRequestSchema.index({ submissionKey: 1 }, { unique: true, sparse: true });
contactRequestSchema.index({ status: 1, createdAt: -1 });

export type ContactRequestDoc = InferSchemaType<typeof contactRequestSchema> & { _id: Id; createdAt: Date };
export const ContactRequest = defineModel("ContactRequest", contactRequestSchema);
