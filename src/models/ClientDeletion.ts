import { Schema, type InferSchemaType } from "mongoose";
import { defineModel, ObjectId } from "./_helpers";

const schema = new Schema({
  tokenHash: { type: String, required: true, unique: true, select: false },
  actorId: { type: ObjectId, required: true },
  organizationId: { type: ObjectId, required: true },
  fingerprint: { type: String, required: true },
  phase: { type: String, enum: ["IDENTITY", "IMPACT", "FINAL", "CONSUMED", "CANCELLED"], required: true },
  expiresAt: { type: Date, required: true, expires: 0 },
}, { timestamps: true });
export type ClientDeletionDoc = InferSchemaType<typeof schema>;
export const ClientDeletion = defineModel("ClientDeletion", schema);
