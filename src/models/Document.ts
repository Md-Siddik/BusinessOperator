import { Schema, type InferSchemaType } from "mongoose";
import { DOCUMENT_CATEGORIES } from "@/lib/constants";
import { defineModel, ObjectId, type Id } from "./_helpers";

const clientDocumentSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true, index: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, enum: DOCUMENT_CATEGORIES, default: "OTHER" },
    fileKey: { type: String, required: true },
    mimeType: String,
    size: Number,
    visibleToClient: { type: Boolean, default: true },
    uploadedBy: { type: ObjectId, ref: "User" },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type ClientDocumentDoc = InferSchemaType<typeof clientDocumentSchema> & { _id: Id; createdAt: Date };
export const ClientDocument = defineModel("ClientDocument", clientDocumentSchema);
