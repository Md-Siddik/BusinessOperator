import { Schema, type InferSchemaType } from "mongoose";
import { defineModel, ObjectId, type Id } from "./_helpers";

/**
 * First-party website analytics (Owner-only). See docs/website-analytics.md.
 *
 * - WebVisitor: one browser that ACCEPTED analytics, keyed by an HMAC of its random cookie id
 *   (the raw cookie value is never stored). Linked to a user or enquiry only through login or
 *   the contact form.
 * - WebSession: one visit (ends after 30 minutes of inactivity).
 * - WebPageView: one page view. Without consent it carries no visitor/session at all.
 *
 * Every document carries `expireAt` (the retention period at write time) with a TTL index.
 */
const utmSchema = new Schema({ source: String, medium: String, campaign: String, term: String, content: String }, { _id: false });

const webVisitorSchema = new Schema(
  {
    vidHash: { type: String, required: true, unique: true },
    /** Short display code ("A82F") derived from the hash — not an identity. */
    label: { type: String, required: true },
    firstSeen: { type: Date, required: true },
    lastSeen: { type: Date, required: true },
    sessions: { type: Number, default: 0 },
    pageViews: { type: Number, default: 0 },
    /** How the visitor first arrived. */
    firstChannel: String,
    firstReferrerDomain: String,
    firstUtm: utmSchema,
    firstLandingPage: String,
    /** Set only through login (CLIENT accounts; the internal team is never tracked). */
    userId: { type: ObjectId, ref: "User" },
    userRole: String,
    /** Enquiries this browser submitted through the contact form. */
    contactRequestIds: { type: [ObjectId], ref: "ContactRequest", default: [] },
    convertedAt: Date,
    expireAt: { type: Date, required: true },
  },
  { timestamps: true },
);
webVisitorSchema.index({ lastSeen: -1 });
webVisitorSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

const webSessionSchema = new Schema(
  {
    visitorId: { type: ObjectId, ref: "WebVisitor", required: true },
    /** 1 for the visitor's first session; > 1 means a returning visit. */
    sessionNo: { type: Number, required: true },
    startedAt: { type: Date, required: true },
    lastSeen: { type: Date, required: true },
    pageViews: { type: Number, default: 0 },
    landingPage: String,
    exitPage: String,
    channel: { type: String, required: true },
    referrer: String,
    referrerDomain: String,
    utm: utmSchema,
    userId: { type: ObjectId, ref: "User" },
    enquiries: { type: Number, default: 0 },
    expireAt: { type: Date, required: true },
  },
  { timestamps: false },
);
webSessionSchema.index({ visitorId: 1, lastSeen: -1 });
webSessionSchema.index({ startedAt: -1 });
webSessionSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

const webPageViewSchema = new Schema(
  {
    at: { type: Date, required: true },
    /** Path as visited, including any language prefix ("/no/services/seo"). */
    path: { type: String, required: true },
    /** Language-neutral page ("/services/seo"), used for page and service statistics. */
    page: { type: String, required: true },
    locale: String,
    /** Set for /services/<slug> pages: the Service Management slug (never hard-coded). */
    serviceSlug: String,
    consented: { type: Boolean, required: true },
    visitorId: { type: ObjectId, ref: "WebVisitor" },
    sessionId: { type: ObjectId, ref: "WebSession" },
    /** First page of a visit: the session's first page, or — without consent — an arrival from outside the site. */
    entry: { type: Boolean, default: false },
    channel: String,
    referrerDomain: String,
    utm: utmSchema,
    expireAt: { type: Date, required: true },
  },
  { timestamps: false },
);
webPageViewSchema.index({ at: -1 });
webPageViewSchema.index({ sessionId: 1, at: 1 });
webPageViewSchema.index({ visitorId: 1, at: 1 });
webPageViewSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export type WebVisitorDoc = InferSchemaType<typeof webVisitorSchema> & { _id: Id; createdAt: Date };
export type WebSessionDoc = InferSchemaType<typeof webSessionSchema> & { _id: Id };
export type WebPageViewDoc = InferSchemaType<typeof webPageViewSchema> & { _id: Id };

export const WebVisitor = defineModel("WebVisitor", webVisitorSchema);
export const WebSession = defineModel("WebSession", webSessionSchema);
export const WebPageView = defineModel("WebPageView", webPageViewSchema);
