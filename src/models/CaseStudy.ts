import { Schema, type InferSchemaType } from "mongoose";
import { defineModel, ObjectId, type Id } from "./_helpers";

const localizedCaseSchema = new Schema(
  {
    title: String,
    summary: String,
    challenge: String,
    solution: String,
    results: { type: [String], default: undefined },
    testimonial: String,
  },
  { _id: false },
);

/**
 * Case study. `isExample: true` marks illustrative content that must be
 * labelled as an example on the public site — never presented as a real client.
 */
const caseStudySchema = new Schema(
  {
    slug: { type: String, required: true, unique: true },
    clientName: { type: String, required: true },
    industry: String,
    countryCode: String,
    services: { type: [String], default: [] },
    technologies: { type: [String], default: [] },
    images: { type: [String], default: [] },
    testimonialAuthor: String,
    /** Base (English) content plus optional per-locale overrides. */
    content: { type: localizedCaseSchema, required: true },
    translations: { type: Map, of: localizedCaseSchema, default: {} },
    isExample: { type: Boolean, default: false },
    published: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    createdBy: { type: ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export type CaseStudyDoc = InferSchemaType<typeof caseStudySchema> & { _id: Id; createdAt: Date };
export type LocalizedCaseContent = InferSchemaType<typeof localizedCaseSchema>;
export const CaseStudy = defineModel("CaseStudy", caseStudySchema);
