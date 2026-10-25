import { Schema, type InferSchemaType } from "mongoose";
import { ACCOUNT_STATUSES } from "@/lib/constants";
import { ROLES } from "@/lib/permissions";
import { defineModel, ObjectId, type Id } from "./_helpers";

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, select: false },
    role: { type: String, enum: ROLES, required: true, index: true },
    /** Explicit permissions for ADMIN/STAFF. Empty → role defaults. */
    permissions: { type: [String], default: [] },
    status: { type: String, enum: ACCOUNT_STATUSES, default: "PENDING_APPROVAL", index: true },
    organizationId: { type: ObjectId, ref: "Organization", index: true },
    phone: String,
    title: String,
    preferredLanguage: { type: String, default: "en" },
    /** Incremented to revoke all existing sessions. */
    sessionVersion: { type: Number, default: 0 },
    invitationTokenHash: { type: String, select: false },
    invitationExpiresAt: { type: Date, select: false },
    emailVerifiedAt: Date,
    verificationActivates: { type: Boolean, default: false },
    mfaChallengeHash: { type: String, select: false },
    authCodeHash: { type: String, select: false },
    authCodeExpiresAt: { type: Date, select: false },
    authCodeSentAt: Date,
    authCodeAttempts: { type: Number, default: 0, select: false },
    authCodePurpose: { type: String, enum: ["VERIFY", "MFA"], select: false },
    lastLoginAt: Date,
    lastSeenAt: Date,
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpiresAt: { type: Date, select: false },
    notificationPrefs: {
      emailOnChatMessage: { type: Boolean, default: true },
      emailOnTicketUpdate: { type: Boolean, default: true },
    },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Id; createdAt: Date; updatedAt: Date };
export const User = defineModel("User", userSchema);
