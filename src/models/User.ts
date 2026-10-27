import { Schema, type InferSchemaType } from "mongoose";
import { ACCOUNT_STATUSES } from "@/lib/constants";
import { ROLES } from "@/lib/permissions";
import { defineModel, ObjectId, type Id } from "./_helpers";

export const GRANT_ORIGINS = ["OWNER", "DELEGATED", "MIGRATION"] as const;
export type GrantOrigin = (typeof GRANT_ORIGINS)[number];

/**
 * One recorded permission grant. A permission is held while at least one grant for it exists,
 * so an independent Owner grant survives when a delegated grant is revoked (see features/access).
 */
const permissionGrantSchema = new Schema(
  {
    permission: { type: String, required: true },
    /** Who granted it (null for grants converted from the pre-grant permission list). */
    grantedBy: { type: ObjectId, ref: "User", default: null },
    grantedByRole: String,
    origin: { type: String, enum: GRANT_ORIGINS, required: true },
    /** The scoped authority a delegate used, e.g. "opportunities.grant". */
    via: String,
    grantedAt: { type: Date, required: true },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, select: false },
    role: { type: String, enum: ROLES, required: true, index: true },
    /**
     * Effective-permission mirror of `permissionGrants` (kept in the same atomic update).
     * Accounts without `permissionGrants` predate per-user grants and keep their old access
     * until the "2026-10-access-grants-v1" migration converts them.
     */
    permissions: { type: [String], default: [] },
    /** Source of truth for non-Owner access, with provenance. Absent until migrated. */
    permissionGrants: { type: [permissionGrantSchema], default: undefined },
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
    /** Who added this team account directly (Owner / Super Admin) and when. */
    addedBy: { type: ObjectId, ref: "User" },
    addedAt: Date,
  },
  { timestamps: true },
);

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Id; createdAt: Date; updatedAt: Date };
export const User = defineModel("User", userSchema);
