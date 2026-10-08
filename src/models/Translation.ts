import { Schema, type InferSchemaType } from "mongoose";
import { defineModel, ObjectId, type Id } from "./_helpers";

/**
 * Admin-edited translation overrides. The JSON dictionaries in /messages are
 * the reviewed baseline; an override replaces a single key for one locale.
 */
const translationSchema = new Schema(
  {
    locale: { type: String, required: true },
    key: { type: String, required: true },
    value: { type: String, required: true, maxlength: 5000 },
    reviewed: { type: Boolean, default: true },
    updatedBy: { type: ObjectId, ref: "User" },
  },
  { timestamps: true },
);

translationSchema.index({ locale: 1, key: 1 }, { unique: true });

export type TranslationDoc = InferSchemaType<typeof translationSchema> & { _id: Id; updatedAt: Date };
export const Translation = defineModel("Translation", translationSchema);
