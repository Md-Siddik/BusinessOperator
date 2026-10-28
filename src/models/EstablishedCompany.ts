import { Schema, type InferSchemaType } from "mongoose";
import { defineModel, type Id } from "./_helpers";

/**
 * Old company Intelligence — its OWN dataset (collection "established_companies").
 *
 * Startup Company Intelligence lives in the Company collection; this collection is never filled
 * from it, never copied into it, and is written only by the established-company collection
 * (historical registration windows of the official registries). A record is stored only when the
 * registry publishes a registration number, a founding / registration date older than the
 * configured threshold and an active status; anything that matches a Startup Company Intelligence
 * record (registration number, registry id or normalized name in the same country) is refused.
 */
const establishedCompanySchema = new Schema(
  {
    countryCode: { type: String, required: true },
    /** Registry adapter id (e.g. "brreg") and the registry's own id for the company. */
    source: { type: String, required: true },
    sourceId: { type: String, required: true },
    sourceName: String,
    sourceUrl: String,
    companyName: { type: String, required: true, trim: true },
    /** Normalized name (lower case, no diacritics / punctuation / legal-form suffix) for duplicate checks. */
    nameKey: { type: String, required: true },
    registrationNumber: { type: String, required: true, trim: true },
    /**
     * Identity keys ("src:NO:brreg:123", "reg:NO:123"). Unique across the collection: two
     * documents can never describe the same registered company.
     */
    identityKeys: { type: [String], required: true },
    incorporationDate: Date,
    registrationDay: String,
    /** Incorporation date when published, otherwise the registration date — the age is measured from here. */
    foundedOn: { type: Date, required: true },
    status: { type: String, required: true },
    legalForm: String,
    industryCode: String,
    industryDescription: String,
    businessActivity: String,
    address: { street: String, postalCode: String, city: String, region: String },
    /** Contact details exactly as the registry publishes them (no enrichment). */
    email: String,
    phone: String,
    website: String,
    employees: Number,
    verification: {
      reason: String,
      basis: { type: [String], default: [] },
      verifiedAt: Date,
    },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
  },
  { timestamps: true, collection: "established_companies" },
);

establishedCompanySchema.index({ countryCode: 1, source: 1, sourceId: 1 }, { unique: true });
establishedCompanySchema.index({ identityKeys: 1 }, { unique: true });
establishedCompanySchema.index({ countryCode: 1, foundedOn: 1 });
establishedCompanySchema.index({ countryCode: 1, registrationNumber: 1 });
establishedCompanySchema.index({ countryCode: 1, nameKey: 1 });
establishedCompanySchema.index({ companyName: 1 });

export type EstablishedCompanyDoc = InferSchemaType<typeof establishedCompanySchema> & { _id: Id; createdAt: Date; updatedAt: Date };
export const EstablishedCompany = defineModel("EstablishedCompany", establishedCompanySchema);
