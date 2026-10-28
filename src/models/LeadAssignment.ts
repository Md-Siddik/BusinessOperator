import { Schema, type InferSchemaType } from "mongoose";
import { defineModel, ObjectId, type Id } from "./_helpers";

export const LEAD_ASSIGNMENT_STATUSES = ["ACTIVE", "WITHDRAWN"] as const;
export type LeadAssignmentStatus = (typeof LEAD_ASSIGNMENT_STATUSES)[number];

/** The marketer's own outreach progress on this lead. Missing = NOT_REACHED. */
export const OUTREACH_STATUSES = ["NOT_REACHED", "MESSAGED", "GOT_RESPONSE"] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

const historySchema = new Schema(
  {
    action: { type: String, enum: ["SENT", "RESENT", "WITHDRAWN", "OUTREACH", "EDITED", "MERGED"], required: true },
    actorId: { type: ObjectId, ref: "User", required: true },
    at: { type: Date, required: true },
    /** For OUTREACH entries: the status chosen (and the one it replaced). */
    outreachStatus: { type: String, enum: OUTREACH_STATUSES },
    previousOutreachStatus: { type: String, enum: OUTREACH_STATUSES },
    /** For EDITED entries: the fields the Owner changed. */
    fields: { type: [String], default: undefined },
  },
  { _id: false },
);

/**
 * A company (lead) the Owner sent to the shared Digital Marketer table. The Company record stays
 * the source of truth for lead data. A table row has no recipient (`recipientId` null): every
 * Digital Marketer holding "View Marketer Table" sees every active row. One row per company
 * (unique company + recipient, with recipient null), so retries and double clicks never duplicate.
 *
 * Rows with a recipient are from before 2026-10-29 (one per company + marketer). Migration
 * "2026-10-marketer-table-v1" merged them into table rows (`formerRecipientId` on the kept row,
 * `mergedInto` on the others) — reversible with `npm run migrate:revert-marketer-access`.
 */
const leadAssignmentSchema = new Schema(
  {
    companyId: { type: ObjectId, ref: "Company", required: true },
    /** Null: a row of the shared marketer table. Set only on rows from before 2026-10-29. */
    recipientId: { type: ObjectId, ref: "User", default: null },
    /** Merge trail (migration 2026-10-marketer-table-v1), for its revert. */
    formerRecipientId: { type: ObjectId, ref: "User" },
    mergedInto: { type: ObjectId, ref: "LeadAssignment" },
    mergedFromStatus: { type: String, enum: LEAD_ASSIGNMENT_STATUSES },
    senderId: { type: ObjectId, ref: "User", required: true },
    countryCode: String,
    status: { type: String, enum: LEAD_ASSIGNMENT_STATUSES, default: "ACTIVE" },
    sentAt: { type: Date, required: true },
    withdrawnAt: Date,
    outreachStatus: { type: String, enum: OUTREACH_STATUSES },
    outreachStatusAt: Date,
    outreachStatusBy: { type: ObjectId, ref: "User" },
    /**
     * Owner corrections to what the Digital Marketer table shows for this lead. The Company record
     * (Startup Company Intelligence) is never changed from the table; a field here overrides it.
     */
    details: {
      companyName: String,
      contactPerson: String,
      contactRole: String,
      phone: String,
      website: String,
      editedAt: Date,
      editedBy: { type: ObjectId, ref: "User" },
    },
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true },
);

leadAssignmentSchema.index({ companyId: 1, recipientId: 1 }, { unique: true });
leadAssignmentSchema.index({ recipientId: 1, status: 1, sentAt: -1 });

export type LeadAssignmentDoc = InferSchemaType<typeof leadAssignmentSchema> & { _id: Id; createdAt: Date; updatedAt: Date };
export const LeadAssignment = defineModel("LeadAssignment", leadAssignmentSchema);
