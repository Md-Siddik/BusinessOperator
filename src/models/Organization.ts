import { Schema, type InferSchemaType } from "mongoose";
import { ACCOUNT_STATUSES } from "@/lib/constants";
import { defineModel, ObjectId, type Id } from "./_helpers";

/**
 * Organization = a client company (tenant). Every client-owned resource
 * (services, projects, tickets, documents, conversations) references it.
 * This is the "Client" entity — there is no separate Client model.
 */
const organizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, unique: true },
    countryCode: { type: String, uppercase: true, index: true },
    website: String,
    industry: String,
    phone: String,
    email: String,
    address: String,
    preferredLanguage: { type: String, default: "en" },
    status: { type: String, enum: ACCOUNT_STATUSES, default: "PENDING_APPROVAL", index: true },
    accountManagerId: { type: ObjectId, ref: "User" },
    /** Link to the company-intelligence record this client came from, if any. */
    companyId: { type: ObjectId, ref: "Company" },
    notes: String,
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type OrganizationDoc = InferSchemaType<typeof organizationSchema> & { _id: Id; createdAt: Date; updatedAt: Date };
export const Organization = defineModel("Organization", organizationSchema);
