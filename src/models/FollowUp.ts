import { Schema, type InferSchemaType } from "mongoose";
import { FOLLOW_UP_TYPES } from "@/lib/constants";
import { defineModel, ObjectId, type Id } from "./_helpers";

const followUpSchema = new Schema(
  {
    companyId: { type: ObjectId, ref: "Company", required: true, index: true },
    countryCode: { type: String, required: true, uppercase: true },
    dueAt: { type: Date, required: true },
    type: { type: String, enum: FOLLOW_UP_TYPES, default: "EMAIL" },
    assignedTo: { type: ObjectId, ref: "User" },
    notes: { type: String, maxlength: 2000 },
    reminder: { type: Boolean, default: true },
    reminderSentAt: Date,
    status: { type: String, enum: ["OPEN", "DONE", "CANCELLED"], default: "OPEN" },
    completedAt: Date,
    createdBy: { type: ObjectId, ref: "User" },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

followUpSchema.index({ status: 1, dueAt: 1 });
followUpSchema.index({ countryCode: 1, status: 1, dueAt: 1 });
followUpSchema.index({ assignedTo: 1, status: 1, dueAt: 1 });

export type FollowUpDoc = InferSchemaType<typeof followUpSchema> & { _id: Id; createdAt: Date };
export const FollowUp = defineModel("FollowUp", followUpSchema);
