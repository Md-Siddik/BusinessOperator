import { Schema, type InferSchemaType } from "mongoose";
import { LEAD_STAGES } from "@/lib/constants";
import { CONTACT_SOURCE_KINDS, ELIGIBILITY_STATES, RELEVANCE_VALUES, RESEARCH_STATUSES } from "@/lib/company-fields";
import { defineModel, ObjectId, type Id } from "./_helpers";

/**
 * A company from a registry provider. Registry fields are stored exactly as
 * normalized from the source — missing data stays empty, never guessed.
 *
 *  - registrationDay: the registry's own registration date (country-local
 *    calendar day, "YYYY-MM-DD"). It decides "registered today" — never createdAt.
 *  - contactSources: where each primary contact value came from (registry,
 *    company website, enrichment provider, manual) — sources are never mixed silently.
 *  - sourceData: the raw provider record (server-side only, never sent to clients).
 *
 * Lead / CRM state is embedded as `lead` so the daily view can filter by
 * qualification, stage and score with one indexed query.
 */
const scoreItemSchema = new Schema({ ruleId: String, label: String, points: Number }, { _id: false });

const leadSchema = new Schema(
  {
    stage: { type: String, enum: LEAD_STAGES, default: "NEW" },
    score: { type: Number, default: 0 },
    scoreBreakdown: { type: [scoreItemSchema], default: [] },
    scoredAt: Date,
    relevance: { type: String, enum: RELEVANCE_VALUES },
    relevanceAt: Date,
    relevanceBy: { type: ObjectId, ref: "User" },
    saved: { type: Boolean, default: false },
    savedAt: Date,
    assignedTo: { type: ObjectId, ref: "User" },
    stageChangedAt: Date,
    qualifiedAt: Date,
    lastContactedAt: Date,
    nextFollowUpAt: Date,
    organizationId: { type: ObjectId, ref: "Organization" },
  },
  { _id: false },
);

const contactSourceSchema = new Schema(
  {
    kind: { type: String, enum: CONTACT_SOURCE_KINDS },
    source: String,
    url: String,
    at: Date,
    verified: Boolean,
  },
  { _id: false },
);

const personSchema = new Schema({ name: String, role: String, roleCode: String, group: String }, { _id: false });

const companySchema = new Schema(
  {
    // Identity
    companyName: { type: String, required: true, trim: true },
    registrationNumber: { type: String, trim: true },
    countryCode: { type: String, required: true, uppercase: true },
    countryName: String,

    // Registration — the source's own date; never createdAt / firstSeenAt.
    registrationDay: String,
    registrationDate: Date,
    /** What the source date means, e.g. "Enhetsregisteret registration date", "Incorporation date", "Legal creation date". */
    registrationDateType: String,
    /** NEW_ENTITY | BRANCH | NAME_CHANGE | RELOCATION | CONTINUATION | CONVERSION | UNKNOWN */
    eventType: { type: String, default: "NEW_ENTITY" },
    /** When the source published / registered the event (timestamp), if it says. */
    sourcePublishedAt: Date,
    /** When ExploreTechify first stored this company (drives "First received today"). */
    firstSeenAt: Date,
    incorporationDate: Date,
    status: String,
    legalForm: String,
    legalFormCode: String,

    // Classification (original source classification preserved)
    industry: { type: String, default: "other" },
    industryCode: String,
    industryDescription: String,
    industryCodeSystem: String,
    naceCode: String,
    businessActivity: String,
    companyPurpose: String,

    // Contact (primary values) + provenance
    email: { type: String, lowercase: true, trim: true },
    phone: String,
    mobile: String,
    website: String,
    contactPerson: { type: personSchema, default: undefined },
    contactSources: {
      email: contactSourceSchema,
      phone: contactSourceSchema,
      mobile: contactSourceSchema,
      website: contactSourceSchema,
      contactPerson: contactSourceSchema,
    },
    socialLinks: { type: [{ network: String, url: String, _id: false }], default: [] },
    /** Verified business contact-form page — an alternative route, never counted as email. */
    contactFormUrl: String,
    /** Contact-first ranking (computed from the Contact provenance store). */
    directContact: {
      has: { type: Boolean, default: false },
      hasEmail: { type: Boolean, default: false },
      hasPhone: { type: Boolean, default: false },
      quality: { type: Number, default: 0 },
      pendingVerification: { type: Boolean, default: false },
      formOnly: { type: Boolean, default: false },
      emailVerification: String,
      phoneVerification: String,
    },
    /** First time a usable direct contact was found ("Contacts found today"). */
    contactFoundAt: Date,
    contactLastVerifiedAt: Date,
    research: {
      status: { type: String, enum: RESEARCH_STATUSES, default: "NOT_STARTED" },
      attempts: { type: Number, default: 0 },
      lastAttemptAt: Date,
      nextRetryAt: Date,
      priority: { type: Number, default: 0 },
      checkedSources: { type: [{ source: String, at: Date, outcome: String, _id: false }], default: [] },
      lastFailure: String,
      costCents: { type: Number, default: 0 },
      reasonForNext: String,
    },
    eligibility: {
      status: { type: String, enum: ELIGIBILITY_STATES, default: "NEEDS_REVIEW" },
      reason: String,
      at: Date,
      by: { type: ObjectId, ref: "User" },
    },
    serviceFit: {
      score: { type: Number, default: 0 },
      assessedAt: Date,
      suggestions: {
        type: [
          {
            packageId: { type: ObjectId, ref: "ServicePackage" },
            packageName: String,
            observation: String,
            source: String,
            confidence: String,
            nextQuestion: String,
            status: { type: String, default: "SUGGESTED" },
            note: String,
            decidedBy: { type: ObjectId, ref: "User" },
            decidedAt: Date,
          },
        ],
        default: [],
      },
    },

    // Address
    address: String,
    postalCode: String,
    city: String,
    region: String,
    postalAddress: String,

    // People / roles
    people: { type: [personSchema], default: [] },
    peopleFetchedAt: Date,
    employees: Number,

    // Data quality (derived on every write)
    contactFlags: {
      email: { type: Boolean, default: false },
      phone: { type: Boolean, default: false },
      mobile: { type: Boolean, default: false },
      website: { type: Boolean, default: false },
      address: { type: Boolean, default: false },
      person: { type: Boolean, default: false },
    },
    completeness: { type: Number, default: 0 },
    fullyContactable: { type: Boolean, default: false },
    /** Source says the company must not receive marketing (e.g. Danish reklamebeskyttelse). */
    marketingProtected: { type: Boolean, default: false },

    // Source & freshness
    source: { type: String, required: true },
    sourceName: String,
    sourceId: { type: String, required: true },
    sourceUrl: String,
    sourceType: String,
    dataFreshness: String,
    sourceFetchedAt: Date,
    sourceUpdatedAt: Date,
    sourceData: { type: Schema.Types.Mixed, select: false },
    /** Hash of the normalized record — unchanged records are counted as skipped. */
    sourceHash: { type: String, select: false },
    isDemo: { type: Boolean, default: false },

    // Research
    signals: {
      hiring: Boolean,
      hiringSource: String,
      hiringCheckedAt: Date,
    },
    digitalOpportunity: { type: Boolean, default: false },
    auditSummary: {
      score: Number,
      checkedAt: Date,
      https: Boolean,
      mobileFriendly: Boolean,
      hasMetaDescription: Boolean,
    },
    enrichment: {
      lastRunAt: Date,
      lastResult: String,
    },
    lead: { type: leadSchema, default: () => ({}) },
    prospectPage: {
      token: String,
      enabled: { type: Boolean, default: false },
      createdAt: Date,
    },
  },
  { timestamps: true },
);

// Deduplication: one record per country + source id, and per country + registration number for real data.
companySchema.index({ countryCode: 1, source: 1, sourceId: 1 }, { unique: true });
companySchema.index({ countryCode: 1, registrationNumber: 1 }, { unique: true, partialFilterExpression: { isDemo: false, registrationNumber: { $type: "string" } } });
// Daily view (contact-first ordering is applied before pagination)
companySchema.index({ countryCode: 1, registrationDay: -1, companyName: 1 });
companySchema.index({ countryCode: 1, registrationDay: -1, "directContact.has": -1, "directContact.quality": -1 });
companySchema.index({ countryCode: 1, firstSeenAt: -1 });
companySchema.index({ countryCode: 1, contactFoundAt: -1 });
companySchema.index({ "research.status": 1, "research.nextRetryAt": 1 });
companySchema.index({ registrationDay: -1, companyName: 1 });
companySchema.index({ countryCode: 1, registrationDay: -1, completeness: -1 });
companySchema.index({ countryCode: 1, industry: 1 });
companySchema.index({ countryCode: 1, "lead.stage": 1 });
companySchema.index({ countryCode: 1, "lead.score": -1 });
companySchema.index({ "lead.saved": 1, "lead.savedAt": -1 });
// Search
companySchema.index({ registrationNumber: 1 });
companySchema.index({ companyName: 1 });
companySchema.index({ email: 1 });
companySchema.index({ phone: 1 });
companySchema.index({ website: 1 });
companySchema.index({ "lead.assignedTo": 1 });
companySchema.index({ "lead.nextFollowUpAt": 1 });
companySchema.index({ createdAt: -1 });
companySchema.index({ "prospectPage.token": 1 }, { sparse: true });

export type CompanyDoc = InferSchemaType<typeof companySchema> & { _id: Id; createdAt: Date; updatedAt: Date };
export type ScoreItem = { ruleId: string; label: string; points: number };
export const Company = defineModel("Company", companySchema);
