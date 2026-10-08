import { Schema, type InferSchemaType } from "mongoose";
import { CLIENT_SERVICE_STATUSES } from "@/lib/constants";
import { defineModel, ObjectId, type Id } from "./_helpers";

/** A service a client organization has, has requested, or completed. */
const clientServiceSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true, index: true },
    category: { type: String, required: true },
    itemKey: String,
    name: { type: String, required: true },
    status: { type: String, enum: CLIENT_SERVICE_STATUSES, default: "PENDING" },
    startedAt: Date,
    completedAt: Date,
    notes: String,
    requestedBy: { type: ObjectId, ref: "User" },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

clientServiceSchema.index({ organizationId: 1, status: 1 });

export type ClientServiceDoc = InferSchemaType<typeof clientServiceSchema> & { _id: Id; createdAt: Date };
export const ClientService = defineModel("ClientService", clientServiceSchema);
