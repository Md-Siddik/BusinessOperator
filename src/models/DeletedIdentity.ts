import { Schema, type InferSchemaType } from "mongoose";
import { defineModel, ObjectId } from "./_helpers";

// Authentication continuity only. Never store roles, grants or memberships here.
const schema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true },
  passwordHash: { type: String, select: false },
  emailVerifiedAt: Date,
  blocked: { type: Boolean, required: true },
  previousUserId: { type: ObjectId, required: true },
  returnUserId: { type: ObjectId, required: true },
  deletedAt: { type: Date, required: true },
});
export type DeletedIdentityDoc = InferSchemaType<typeof schema>;
export const DeletedIdentity = defineModel("DeletedIdentity", schema);
