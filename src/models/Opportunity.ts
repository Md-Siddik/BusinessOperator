import { Schema, type InferSchemaType } from "mongoose";
import {
  ACTIVITY_STATUSES,
  CONTACT_KINDS,
  CONTACT_ROUTES,
  EMPLOYER_IDENTITY,
  MANUAL_VERIFICATION_RESULTS,
  OPPORTUNITY_TYPES,
  REVIEW_STATUSES,
  SERVICE_CATEGORIES,
  SOURCE_CLASSES,
  SOURCE_STATES,
  VERIFICATION_LABELS,
} from "@/features/opportunities/constants";
import { defineModel, ObjectId, type Id } from "./_helpers";

/**
 * One opportunity as published by ONE source (provider + external id). OWNER-ONLY data.
 *
 * Deduplication never deletes source records: records that describe the same
 * opportunity share a `dupGroup`; exactly one is `isCanonical` (the most
 * authoritative source). Lists and metrics count canonical records; the detail
 * page shows every source record of the group as evidence.
 *
 * Timestamps are kept strictly apart:
 *   publishedAt / sourceUpdatedAt — from the source; left empty when the source gives none
 *   firstSeenAt                   — when ExploreTechify first discovered it
 *   lastSeenAt                    — last time the source itself confirmed it (listing, stream or status check)
 *   lastCheckedAt                 — last attempt to check (may have failed — see lastCheckResult)
 */
const evidenceSchema = new Schema(
  {
    kind: { type: String, required: true },
    result: { type: String, enum: ["PASS", "FAIL", "INCONCLUSIVE"], required: true },
    detail: { type: String, maxlength: 1000 },
    url: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const contactSchema = new Schema(
  {
    kind: { type: String, enum: CONTACT_KINDS, required: true },
    name: String,
    role: String,
    email: { type: String, lowercase: true, trim: true },
    phone: String,
    url: String,
    /** Provenance — where this contact was published and when we last saw it there. */
    sourceProvider: String,
    sourceUrl: String,
    checkedAt: Date,
    /** True when the contact's domain differs from the organization's own domain (e.g. a procurement agent). */
    thirdParty: Boolean,
  },
  { _id: false },
);

const noteSchema = new Schema({ text: { type: String, maxlength: 5000, required: true }, at: { type: Date, default: Date.now }, by: { type: ObjectId, ref: "User" } }, { _id: true });

const opportunitySchema = new Schema(
  {
    type: { type: String, enum: OPPORTUNITY_TYPES, required: true },
    providerId: { type: String, required: true },
    feedId: { type: ObjectId, ref: "OpportunityFeed" },
    externalId: { type: String, required: true },

    title: { type: String, trim: true },
    organization: {
      name: { type: String, trim: true },
      /** Lower-cased, legal-suffix-stripped name (grouping only — never used to merge companies). */
      normalizedName: String,
      registrationNumber: String,
      registrationCountry: String,
      website: String,
      domain: String,
    },
    countryCode: { type: String, uppercase: true },
    location: String,
    summary: { type: String, maxlength: 6000 },

    sourceUrl: String,
    /** Employer/buyer-controlled application or submission URL, when one is known. */
    applyUrl: String,
    canonicalUrlKey: String,
    sourceClass: { type: String, enum: SOURCE_CLASSES, required: true },
    sourcePublisher: String,

    publishedAt: Date,
    sourceUpdatedAt: Date,
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: Date,
    lastCheckedAt: Date,
    lastCheckResult: String,
    nextCheckAt: Date,
    consecutiveCheckFailures: { type: Number, default: 0 },
    /** Consecutive complete listings in which the posting was absent (listing-diff providers). */
    missingFromListings: { type: Number, default: 0 },
    deadline: Date,
    /** Deadline exactly as published when it is not a precise timestamp (e.g. "2026-11-09+01:00"). */
    deadlineText: String,

    activity: { type: String, enum: ACTIVITY_STATUSES, default: "UNKNOWN" },
    sourceState: { type: String, enum: SOURCE_STATES, default: "UNKNOWN" },
    closedAt: Date,
    removedAt: Date,
    archivedAt: Date,

    /** How the publisher itself was verified (AUTHORITATIVE_SOURCE, LINKED_FROM_OFFICIAL_DOMAIN, ON_OFFICIAL_DOMAIN, LINK_NOT_FOUND, NOT_CHECKED, AGGREGATOR). */
    sourceVerification: { status: String, detail: String, url: String, at: Date },
    /** What the source said about closure in the last import (e.g. OCDS tender status "cancelled"). */
    sourceSaysClosed: { type: Boolean, default: false },
    employerIdentity: { type: String, enum: EMPLOYER_IDENTITY, default: "NOT_CONFIRMED" },
    labels: { type: [{ type: String, enum: VERIFICATION_LABELS }], default: [] },
    reviewReasons: { type: [String], default: [] },
    evidence: { type: [evidenceSchema], default: [] },
    lastVerification: { result: String, detail: String, at: Date },

    contacts: { type: [contactSchema], default: [] },
    contactRoutes: { type: [{ type: String, enum: CONTACT_ROUTES }], default: [] },
    hasDirectLink: { type: Boolean, default: false },
    hasContact: { type: Boolean, default: false },

    /** Published classification (CPV / occupation / department) exactly as the source gives it. */
    classification: {
      scheme: String,
      codes: { type: [String], default: undefined },
      labels: { type: [String], default: undefined },
    },
    jobCategory: String,
    employmentType: String,
    serviceCategories: { type: [{ type: String, enum: SERVICE_CATEGORIES }], default: [] },
    /** How serviceCategories were derived: always from published data, never inferred from website quality. */
    serviceCategoryBasis: { type: String, enum: ["PUBLISHED_CLASSIFICATION", "PUBLISHED_TEXT_KEYWORDS", "NONE"], default: "NONE" },
    noticeKind: String,

    companyLink: {
      companyId: { type: ObjectId, ref: "Company" },
      method: { type: String, enum: ["REGISTRATION_NUMBER", "OFFICIAL_DOMAIN", "OWNER_LINKED"] },
      at: Date,
    },

    dupGroup: String,
    isCanonical: { type: Boolean, default: true },
    dedupeMethod: { type: String, enum: ["NONE", "CANONICAL_URL", "FALLBACK_MATCH"], default: "NONE" },
    fallbackKey: String,

    // Owner workflow
    saved: { type: Boolean, default: false },
    savedAt: Date,
    reviewStatus: { type: String, enum: REVIEW_STATUSES, default: "NEW" },
    manualVerification: {
      result: { type: String, enum: MANUAL_VERIFICATION_RESULTS },
      note: String,
      at: Date,
      by: { type: ObjectId, ref: "User" },
    },
    notes: { type: [noteSchema], default: [] },
    lastNoteAt: Date,
    crmSyncedAt: Date,

    /** Hash of the normalized source content — unchanged imports are counted, not rewritten. */
    contentHash: { type: String, select: false },
    /** Content purged because the source's terms require removal of inactive records. */
    contentPurged: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Idempotent ingestion: one record per provider + external id.
opportunitySchema.index({ providerId: 1, externalId: 1 }, { unique: true });
// List views (canonical only, server-side filtering + pagination)
opportunitySchema.index({ isCanonical: 1, type: 1, firstSeenAt: -1 });
opportunitySchema.index({ isCanonical: 1, countryCode: 1, type: 1, firstSeenAt: -1 });
opportunitySchema.index({ isCanonical: 1, type: 1, publishedAt: -1 });
opportunitySchema.index({ isCanonical: 1, type: 1, deadline: 1 });
opportunitySchema.index({ isCanonical: 1, activity: 1, type: 1 });
opportunitySchema.index({ isCanonical: 1, labels: 1 });
opportunitySchema.index({ saved: 1, savedAt: -1 });
opportunitySchema.index({ lastNoteAt: -1 });
// Dedup lookups
opportunitySchema.index({ dupGroup: 1 });
opportunitySchema.index({ canonicalUrlKey: 1 });
opportunitySchema.index({ fallbackKey: 1 });
// Monitoring
opportunitySchema.index({ activity: 1, nextCheckAt: 1 });
opportunitySchema.index({ feedId: 1, sourceState: 1 });
opportunitySchema.index({ "companyLink.companyId": 1 });
opportunitySchema.index({ "organization.normalizedName": 1 });
opportunitySchema.index({ title: "text", "organization.name": "text", summary: "text" }, { weights: { title: 5, "organization.name": 3, summary: 1 }, default_language: "none" });

export type OpportunityDoc = InferSchemaType<typeof opportunitySchema> & { _id: Id; createdAt: Date; updatedAt: Date };
export const Opportunity = defineModel("Opportunity", opportunitySchema);

/** Status, verification and owner-action history for one opportunity. */
const opportunityEventSchema = new Schema(
  {
    opportunityId: { type: ObjectId, ref: "Opportunity", required: true },
    kind: { type: String, required: true },
    from: String,
    to: String,
    detail: { type: String, maxlength: 1000 },
    runId: { type: ObjectId, ref: "OpportunitySyncRun" },
    actorId: { type: ObjectId, ref: "User" },
    at: { type: Date, default: Date.now },
  },
  { timestamps: false },
);
opportunityEventSchema.index({ opportunityId: 1, at: -1 });

export type OpportunityEventDoc = InferSchemaType<typeof opportunityEventSchema> & { _id: Id };
export const OpportunityEvent = defineModel("OpportunityEvent", opportunityEventSchema);
