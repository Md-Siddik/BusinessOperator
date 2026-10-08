import { Schema, type InferSchemaType } from "mongoose";
import { defineModel, type Id } from "./_helpers";

/**
 * Durable background job (contact research, registry follow-ups, verification).
 * Idempotent on key: enqueueing the same key again only moves its run time earlier.
 * Failed jobs retry with backoff; after maxAttempts they move to DEAD (dead-letter).
 */
export const JOB_STATUSES = ["QUEUED", "RUNNING", "DONE", "FAILED", "DEAD"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

const jobSchema = new Schema(
  {
    type: { type: String, required: true },
    key: { type: String, required: true, unique: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: JOB_STATUSES, default: "QUEUED" },
    priority: { type: Number, default: 0 },
    runAt: { type: Date, default: Date.now },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    lockedUntil: Date,
    lastError: String,
    finishedAt: Date,
  },
  { timestamps: true },
);
jobSchema.index({ status: 1, runAt: 1, priority: -1 });
jobSchema.index({ type: 1, status: 1 });

export type JobDoc = InferSchemaType<typeof jobSchema> & { _id: Id; createdAt: Date };
export const Job = defineModel("Job", jobSchema);
