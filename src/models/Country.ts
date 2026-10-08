import { Schema, type InferSchemaType } from "mongoose";
import { defineModel, type Id } from "./_helpers";

/**
 * Runtime settings and provider status for a company-intelligence country.
 * Static metadata (name, registry, timezone) lives in src/config/countries.ts.
 */
const countrySchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true },
    enabled: { type: Boolean, default: true },
    providerId: { type: String, required: true },
    syncEnabled: { type: Boolean, default: true },
    /** Scheduled sync interval. Defaults to the provider's recommendation. */
    syncIntervalMinutes: { type: Number, min: 15 },
    /** Days to backfill on the first sync. */
    backfillDays: { type: Number, default: 7, min: 0, max: 90 },
    lastSyncAt: Date,
    lastSyncStatus: String,
    lastSuccessAt: Date,
    lastSyncId: String,
    /** When the source itself last published data (e.g. dataset modification time). */
    latestPublicationAt: Date,
    providerStatus: {
      state: String,
      message: String,
      checkedAt: Date,
    },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export type CountryDoc = InferSchemaType<typeof countrySchema> & { _id: Id };
export const Country = defineModel("Country", countrySchema);
