import { Schema, type InferSchemaType } from "mongoose";
import { defineModel, ObjectId, type Id } from "./_helpers";

/** Research inbox: newly contactable companies, verification changes, service matches, review needs. */
export const INBOX_TYPES = ["NEW_CONTACTABLE", "VERIFICATION_CHANGE", "SERVICE_MATCH", "REVIEW_NEEDED", "SOURCE_ISSUE"] as const;
export type InboxType = (typeof INBOX_TYPES)[number];

const inboxItemSchema = new Schema(
  {
    type: { type: String, enum: INBOX_TYPES, required: true },
    /** Deduplication key — the same event never creates two items. */
    dedupeKey: { type: String, required: true, unique: true },
    companyId: { type: ObjectId, ref: "Company" },
    countryCode: String,
    title: { type: String, required: true },
    body: String,
    priority: { type: Number, default: 0 },
    readAt: Date,
    archivedAt: Date,
  },
  { timestamps: true },
);
inboxItemSchema.index({ archivedAt: 1, createdAt: -1 });

export type InboxItemDoc = InferSchemaType<typeof inboxItemSchema> & { _id: Id; createdAt: Date };
export const InboxItem = defineModel("InboxItem", inboxItemSchema);
