import { Schema, type InferSchemaType } from "mongoose";
import { defineModel, ObjectId, type Id } from "./_helpers";

/** One provider call — drives budgets and cost-per-newly-contactable-company reporting. */
const providerUsageSchema = new Schema(
  {
    provider: { type: String, required: true },
    operation: { type: String, required: true },
    companyId: { type: ObjectId, ref: "Company" },
    countryCode: String,
    costCents: { type: Number, default: 0 },
    outcome: { type: String, enum: ["FOUND", "NOT_FOUND", "ERROR", "QUOTA", "CACHED"], required: true },
    detail: String,
    at: { type: Date, default: Date.now },
  },
  { timestamps: false },
);
providerUsageSchema.index({ at: -1 });
providerUsageSchema.index({ provider: 1, at: -1 });
providerUsageSchema.index({ companyId: 1 });

export type ProviderUsageDoc = InferSchemaType<typeof providerUsageSchema> & { _id: Id };
export const ProviderUsage = defineModel("ProviderUsage", providerUsageSchema);

/** Cached lookup result — avoids paying again for an unchanged result. */
const lookupCacheSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    provider: String,
    result: { type: Schema.Types.Mixed },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
lookupCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type LookupCacheDoc = InferSchemaType<typeof lookupCacheSchema> & { _id: Id };
export const LookupCache = defineModel("LookupCache", lookupCacheSchema);
