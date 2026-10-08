import { Schema, type InferSchemaType } from "mongoose";
import { EMAIL_KINDS, EMAIL_STATUSES } from "@/lib/constants";
import { defineModel, ObjectId, type Id } from "./_helpers";

/**
 * Every email the platform sends or drafts. OUTREACH messages pass through
 * Draft → Review (PENDING_APPROVAL) → Approve → Send, with suppression checks
 * at approval and again at send. TRANSACTIONAL messages are logged here too.
 */
const emailMessageSchema = new Schema(
  {
    kind: { type: String, enum: EMAIL_KINDS, required: true },
    campaignId: { type: ObjectId, ref: "EmailCampaign" },
    companyId: { type: ObjectId, ref: "Company" },
    templateId: { type: ObjectId, ref: "EmailTemplate" },
    countryCode: { type: String, uppercase: true },
    languageCode: String,
    to: { type: String, required: true, lowercase: true, trim: true },
    toName: String,
    from: String,
    subject: { type: String, required: true },
    body: { type: String, required: true },
    personalization: { type: Schema.Types.Mixed },
    status: { type: String, enum: EMAIL_STATUSES, default: "DRAFT" },
    replyStatus: { type: String, enum: ["NONE", "REPLIED"], default: "NONE" },
    repliedAt: Date,
    contactSource: String,
    compliance: {
      checkedAt: Date,
      suppressed: Boolean,
      reason: String,
    },
    submittedBy: { type: ObjectId, ref: "User" },
    approvedBy: { type: ObjectId, ref: "User" },
    approvedAt: Date,
    rejectedReason: String,
    sentAt: Date,
    deliveredAt: Date,
    provider: String,
    providerMessageId: String,
    simulated: { type: Boolean, default: false },
    error: String,
    createdBy: { type: ObjectId, ref: "User" },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

emailMessageSchema.index({ kind: 1, status: 1, createdAt: -1 });
emailMessageSchema.index({ campaignId: 1, status: 1 });
emailMessageSchema.index({ companyId: 1, createdAt: -1 });
emailMessageSchema.index({ countryCode: 1, kind: 1, status: 1 });
emailMessageSchema.index({ to: 1 });

export type EmailMessageDoc = InferSchemaType<typeof emailMessageSchema> & { _id: Id; createdAt: Date; updatedAt: Date };
export const EmailMessage = defineModel("EmailMessage", emailMessageSchema);
