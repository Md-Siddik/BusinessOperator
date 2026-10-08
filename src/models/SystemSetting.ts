import { Schema, type InferSchemaType } from "mongoose";
import { defineModel, ObjectId, type Id } from "./_helpers";

/** Key/value settings, each validated by its own Zod schema in features/settings. */
const systemSettingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
    updatedBy: { type: ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export type SystemSettingDoc = InferSchemaType<typeof systemSettingSchema> & { _id: Id };
export const SystemSetting = defineModel("SystemSetting", systemSettingSchema);
