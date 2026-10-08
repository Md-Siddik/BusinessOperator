import { Schema, type InferSchemaType } from "mongoose";
import { defineModel, ObjectId, type Id } from "./_helpers";

const auditLogSchema = new Schema(
  {
    actorId: { type: ObjectId, ref: "User" },
    actorEmail: String,
    actorRole: String,
    action: { type: String, required: true },
    entityType: String,
    entityId: String,
    countryCode: String,
    organizationId: { type: ObjectId, ref: "Organization" },
    metadata: { type: Schema.Types.Mixed },
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1 });

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema> & { _id: Id; createdAt: Date };
export const AuditLog = defineModel("AuditLog", auditLogSchema);
