import { Schema, type InferSchemaType } from "mongoose";
import { CAMPAIGN_STATUSES, LEAD_STAGES } from "@/lib/constants";
import { defineModel, ObjectId, type Id } from "./_helpers";

const emailCampaignSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    countryCode: { type: String, required: true, uppercase: true, index: true },
    languageCode: { type: String, required: true },
    industry: String,
    segment: {
      minScore: { type: Number, default: 0 },
      requireEmail: { type: Boolean, default: true },
      stages: { type: [{ type: String, enum: LEAD_STAGES }], default: ["QUALIFIED", "READY_FOR_OUTREACH"] },
      registeredWithinDays: Number,
      noWebsiteOnly: { type: Boolean, default: false },
    },
    templateId: { type: ObjectId, ref: "EmailTemplate", required: true },
    status: { type: String, enum: CAMPAIGN_STATUSES, default: "DRAFT" },
    createdBy: { type: ObjectId, ref: "User" },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type EmailCampaignDoc = InferSchemaType<typeof emailCampaignSchema> & { _id: Id; createdAt: Date };
export const EmailCampaign = defineModel("EmailCampaign", emailCampaignSchema);
