import { Schema, type InferSchemaType } from "mongoose";
import { defineModel, ObjectId, type Id } from "./_helpers";

const websiteAuditSchema = new Schema(
  {
    companyId: { type: ObjectId, ref: "Company", required: true, index: true },
    url: { type: String, required: true },
    finalUrl: String,
    checkedAt: { type: Date, default: Date.now },
    ok: { type: Boolean, default: false },
    error: String,
    robotsAllowed: Boolean,
    statusCode: Number,
    https: Boolean,
    mobileFriendly: Boolean,
    title: String,
    metaDescription: String,
    hasOpenGraph: Boolean,
    h1Count: Number,
    socialLinks: { type: [String], default: [] },
    hasContactInfo: Boolean,
    contactEmails: { type: [String], default: [] },
    technologies: { type: [String], default: [] },
    responseTimeMs: Number,
    pageSizeKb: Number,
    brokenLinks: { type: [String], default: [] },
    linksChecked: Number,
    score: Number,
    issues: { type: [String], default: [] },
    isDemo: { type: Boolean, default: false },
    checkedBy: { type: ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export type WebsiteAuditDoc = InferSchemaType<typeof websiteAuditSchema> & { _id: Id };
export const WebsiteAudit = defineModel("WebsiteAudit", websiteAuditSchema);
