import { Schema, type InferSchemaType } from "mongoose";
import { SYNC_STATUSES } from "@/lib/constants";
import { defineModel, ObjectId, type Id } from "./_helpers";

/** One registry synchronization run (manual, scheduled or initial backfill). */
const registrySyncSchema = new Schema(
  {
    countryCode: { type: String, required: true, uppercase: true },
    providerId: { type: String, required: true },
    trigger: { type: String, enum: ["MANUAL", "SCHEDULED", "SEED"], default: "MANUAL" },
    kind: { type: String, enum: ["TODAY", "DATE", "RANGE", "BACKFILL"], default: "TODAY" },
    rangeFrom: String,
    rangeTo: String,
    status: { type: String, enum: SYNC_STATUSES, default: "RUNNING" },
    startedAt: { type: Date, default: Date.now },
    finishedAt: Date,
    heartbeatAt: Date,
    durationMs: Number,
    progress: String,
    sourceTotal: Number,
    complete: Boolean,
    fetched: { type: Number, default: 0 },
    imported: { type: Number, default: 0 },
    updated: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    peopleFetched: { type: Number, default: 0 },
    errorLog: { type: [String], default: [] },
    triggeredBy: { type: ObjectId, ref: "User" },
    isLiveSource: { type: Boolean, default: false },
  },
  { timestamps: true },
);

registrySyncSchema.index({ countryCode: 1, startedAt: -1 });
registrySyncSchema.index({ status: 1, countryCode: 1 });

export type RegistrySyncDoc = InferSchemaType<typeof registrySyncSchema> & { _id: Id };
export const RegistrySync = defineModel("RegistrySync", registrySyncSchema);
