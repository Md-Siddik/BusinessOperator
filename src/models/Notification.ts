import { Schema, type InferSchemaType } from "mongoose";
import { NOTIFICATION_TYPES } from "@/lib/constants";
import { defineModel, ObjectId, type Id } from "./_helpers";

const notificationSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, maxlength: 1000 },
    link: String,
    /** Groups related notifications, e.g. one unread chat notification per conversation. */
    groupKey: String,
    readAt: Date,
  },
  { timestamps: true },
);

notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, groupKey: 1 });

export type NotificationDoc = InferSchemaType<typeof notificationSchema> & { _id: Id; createdAt: Date; updatedAt: Date };
export const Notification = defineModel("Notification", notificationSchema);
