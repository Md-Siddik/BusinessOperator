import { Schema, type InferSchemaType } from "mongoose";
import { SYNC_STATUSES } from "@/lib/constants";
import { defineModel, ObjectId, type Id } from "./_helpers";

/**
 * One configured source feed for opportunity intelligence. OWNER-ONLY.
 *  - kind PROVIDER: one per national/global provider (TED, JobTech, …), created automatically.
 *  - kind EMPLOYER: one per employer board / careers page the owner adds (Greenhouse token, Lever site, …).
 * Health and the incremental cursor live here, so a restart resumes where it stopped.
 * Credentials are NEVER stored here — they come from server environment variables.
 */
const feedSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    providerId: { type: String, required: true },
    kind: { type: String, enum: ["PROVIDER", "EMPLOYER"], required: true },
    label: String,
    enabled: { type: Boolean, default: false },
    /** Employer feeds: board token / site / careers URL, employer name and official domain. */
    config: { type: Schema.Types.Mixed, default: {} },
    /** Owner-editable scope (CPV prefixes, occupation fields, keywords …). */
    settings: { type: Schema.Types.Mixed, default: {} },
    cursor: String,
    intervalMinutes: Number,
    nextRunAt: Date,
    lockedUntil: Date,
    health: {
      lastRunAt: Date,
      lastRunStatus: { type: String, enum: SYNC_STATUSES },
      lastSuccessAt: Date,
      lastErrorAt: Date,
      lastError: String,
      consecutiveFailures: { type: Number, default: 0 },
      rateLimitedUntil: Date,
    },
    /** Employer feeds: is the board linked from the employer's official domain? */
    verification: {
      status: { type: String, enum: ["NOT_CHECKED", "LINKED_FROM_OFFICIAL_DOMAIN", "LINK_NOT_FOUND", "FETCH_FAILED", "SAME_DOMAIN"], default: "NOT_CHECKED" },
      checkedAt: Date,
      evidenceUrl: String,
      detail: String,
    },
    createdBy: { type: ObjectId, ref: "User" },
  },
  { timestamps: true },
);
feedSchema.index({ enabled: 1, nextRunAt: 1 });
feedSchema.index({ providerId: 1 });

export type OpportunityFeedDoc = InferSchemaType<typeof feedSchema> & { _id: Id; createdAt: Date; updatedAt: Date };
export const OpportunityFeed = defineModel("OpportunityFeed", feedSchema);

/** One synchronization run of one feed. Failed runs never delete or close stored opportunities. */
const syncRunSchema = new Schema(
  {
    feedId: { type: ObjectId, ref: "OpportunityFeed", required: true },
    feedKey: String,
    providerId: { type: String, required: true },
    trigger: { type: String, enum: ["SCHEDULED", "MANUAL"], default: "SCHEDULED" },
    status: { type: String, enum: SYNC_STATUSES, default: "RUNNING" },
    startedAt: { type: Date, default: Date.now },
    finishedAt: Date,
    durationMs: Number,
    cursorBefore: String,
    cursorAfter: String,
    /** False when the run stopped at its per-run cap; the next run continues from the cursor. */
    complete: Boolean,
    fetched: { type: Number, default: 0 },
    created: { type: Number, default: 0 },
    updated: { type: Number, default: 0 },
    unchanged: { type: Number, default: 0 },
    outOfScope: { type: Number, default: 0 },
    removed: { type: Number, default: 0 },
    duplicatesLinked: { type: Number, default: 0 },
    rateLimited: { type: Boolean, default: false },
    errorLog: { type: [String], default: [] },
    triggeredBy: { type: ObjectId, ref: "User" },
  },
  { timestamps: false },
);
syncRunSchema.index({ startedAt: -1 });
syncRunSchema.index({ feedId: 1, startedAt: -1 });
syncRunSchema.index({ status: 1, startedAt: -1 });

export type OpportunitySyncRunDoc = InferSchemaType<typeof syncRunSchema> & { _id: Id };
export const OpportunitySyncRun = defineModel("OpportunitySyncRun", syncRunSchema);
