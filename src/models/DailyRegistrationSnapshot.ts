import { Schema, type InferSchemaType } from "mongoose";
import { defineModel, type Id } from "./_helpers";

/**
 * Pre-aggregated count of companies registered per country per registry day,
 * recomputed from the Company collection after every sync. Lets the dashboard
 * answer "how many companies were registered today?" instantly.
 */
const snapshotSchema = new Schema(
  {
    countryCode: { type: String, required: true, uppercase: true },
    /** Registry calendar day, "YYYY-MM-DD" in the country's timezone. */
    date: { type: String, required: true },
    isDemo: { type: Boolean, default: false },
    newCompanies: { type: Number, default: 0 },
    withEmail: { type: Number, default: 0 },
    withPhone: { type: Number, default: 0 },
    withWebsite: { type: Number, default: 0 },
    withContactPerson: { type: Number, default: 0 },
    fullyContactable: { type: Number, default: 0 },
    /** Usable direct email or phone (either counts; a company with both counts once). */
    withDirectContact: { type: Number, default: 0 },
    /** Total reported by the source for that day at the last sync (may exceed what was imported). */
    sourceTotal: Number,
    /** True when the last sync covering this day fetched everything the source reported. */
    complete: { type: Boolean, default: true },
    providerId: String,
    lastUpdatedAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

snapshotSchema.index({ countryCode: 1, isDemo: 1, date: -1 }, { unique: true });
snapshotSchema.index({ date: -1 });

export type DailyRegistrationSnapshotDoc = InferSchemaType<typeof snapshotSchema> & { _id: Id };
export const DailyRegistrationSnapshot = defineModel("DailyRegistrationSnapshot", snapshotSchema);
