import { Schema, type InferSchemaType } from "mongoose";
import { CRM_ACTIVITY_TYPES } from "@/lib/constants";
import { defineModel, ObjectId, type Id } from "./_helpers";

const crmActivitySchema = new Schema(
  {
    companyId: { type: ObjectId, ref: "Company", required: true },
    countryCode: { type: String, required: true, uppercase: true },
    type: { type: String, enum: CRM_ACTIVITY_TYPES, required: true },
    body: { type: String, maxlength: 5000 },
    meta: { type: Schema.Types.Mixed },
    actorId: { type: ObjectId, ref: "User" },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

crmActivitySchema.index({ companyId: 1, createdAt: -1 });
crmActivitySchema.index({ countryCode: 1, createdAt: -1 });

export type CrmActivityDoc = InferSchemaType<typeof crmActivitySchema> & { _id: Id; createdAt: Date };
export const CrmActivity = defineModel("CrmActivity", crmActivitySchema);
