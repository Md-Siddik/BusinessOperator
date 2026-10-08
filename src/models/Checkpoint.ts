import { Schema, type InferSchemaType } from "mongoose";
import { defineModel, type Id } from "./_helpers";

/**
 * Durable position in an upstream feed (Brreg update id, Companies House stream
 * timepoint, KVK signal time). Saved only after the records were durably processed.
 */
const checkpointSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: String, required: true },
    /** Latest source publication time seen (for observed-delay metrics). */
    lastSourceAt: Date,
    /** Observed delays (ms) between source publication and our storage — rolling sample. */
    delaySamples: { type: [Number], default: [] },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

export type CheckpointDoc = InferSchemaType<typeof checkpointSchema> & { _id: Id; updatedAt: Date };
export const Checkpoint = defineModel("Checkpoint", checkpointSchema);
