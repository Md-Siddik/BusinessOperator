import { Schema, type InferSchemaType } from "mongoose";
import { PRIORITIES, REQUEST_TYPES, TICKET_KINDS, TICKET_STATUSES } from "@/lib/constants";
import { defineModel, ObjectId, type Id } from "./_helpers";

export const attachmentSchema = new Schema(
  {
    fileKey: { type: String, required: true },
    name: { type: String, required: true },
    mimeType: String,
    size: Number,
  },
  { _id: true },
);

/**
 * Client service requests and support tickets share one model (`kind`), so
 * workflow, assignment, comments and authorization are implemented once.
 */
const supportTicketSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true },
    kind: { type: String, enum: TICKET_KINDS, required: true },
    number: { type: Number, required: true },
    requestType: { type: String, enum: REQUEST_TYPES },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, maxlength: 10_000 },
    status: { type: String, enum: TICKET_STATUSES, default: "OPEN" },
    priority: { type: String, enum: PRIORITIES, default: "NORMAL" },
    assignedTo: { type: ObjectId, ref: "User" },
    createdBy: { type: ObjectId, ref: "User", required: true },
    dueDate: Date,
    resolvedAt: Date,
    attachments: { type: [attachmentSchema], default: [] },
    comments: {
      type: [
        {
          authorId: { type: ObjectId, ref: "User" },
          body: { type: String, maxlength: 5000 },
          internal: { type: Boolean, default: false },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

supportTicketSchema.index({ organizationId: 1, kind: 1, status: 1 });
supportTicketSchema.index({ kind: 1, status: 1, priority: 1, updatedAt: -1 });
supportTicketSchema.index({ assignedTo: 1, status: 1 });
supportTicketSchema.index({ number: 1 }, { unique: true });

export type SupportTicketDoc = InferSchemaType<typeof supportTicketSchema> & { _id: Id; createdAt: Date; updatedAt: Date };
export const SupportTicket = defineModel("SupportTicket", supportTicketSchema);
