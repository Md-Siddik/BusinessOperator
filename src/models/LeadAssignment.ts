import { Schema, type InferSchemaType } from "mongoose";
import { defineModel, ObjectId, type Id } from "./_helpers";

export const LEAD_ASSIGNMENT_STATUSES = ["ACTIVE", "WITHDRAWN"] as const;
export type LeadAssignmentStatus = (typeof LEAD_ASSIGNMENT_STATUSES)[number];

const historySchema = new Schema(
  {
    action: { type: String, enum: ["SENT", "RESENT", "WITHDRAWN"], required: true },
    actorId: { type: ObjectId, ref: "User", required: true },
    at: { type: Date, required: true },
  },
  { _id: false },
);

/**
 * A company (lead) the Owner sent to a Digital Marketer. The Company record stays the source
 * of truth for lead data; this only records who may work on it. One document per
 * company + recipient (unique), so retries and double clicks never create duplicates.
 * Visibility additionally requires the recipient's "View Assigned Client Leads" permission.
 */
const leadAssignmentSchema = new Schema(
  {
    companyId: { type: ObjectId, ref: "Company", required: true },
    recipientId: { type: ObjectId, ref: "User", required: true },
    senderId: { type: ObjectId, ref: "User", required: true },
    countryCode: String,
    status: { type: String, enum: LEAD_ASSIGNMENT_STATUSES, default: "ACTIVE" },
    sentAt: { type: Date, required: true },
    withdrawnAt: Date,
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true },
);

leadAssignmentSchema.index({ companyId: 1, recipientId: 1 }, { unique: true });
leadAssignmentSchema.index({ recipientId: 1, status: 1, sentAt: -1 });

export type LeadAssignmentDoc = InferSchemaType<typeof leadAssignmentSchema> & { _id: Id; createdAt: Date; updatedAt: Date };
export const LeadAssignment = defineModel("LeadAssignment", leadAssignmentSchema);
