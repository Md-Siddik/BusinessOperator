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
 * Location is coarse (country, region, city); IP addresses are never stored.
 *
 * Every raw document carries `expireAt` (the retention period at write time) with a TTL index.
 *
 * Durable history (no TTL): WebAnalyticsDaily holds one row of aggregated, anonymous statistics
 * per Norwegian calendar day, rolled up from the raw records before they expire. Past days are
 * frozen ("final") and never recomputed, so raw expiry never lowers historical numbers.
 * WebConversion records lead submissions with first/last-touch attribution (consented browsers only).
 * WebEventKey de-duplicates beacons (a retried or repeated request is counted once).
 */
const utmSchema = new Schema({ source: String, medium: String, campaign: String, term: String, content: String }, { _id: false });
/** Coarse location from hosting headers or a local GeoIP lookup — the IP address itself is never stored. */
const geoSchema = new Schema({ country: String, region: String, city: String }, { _id: false });

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
    /** Last known location and browser time zone. */
    geo: geoSchema,
    timeZone: String,
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
    geo: geoSchema,
    /** The visitor's browser time zone, to show the visit in their local time. */
    timeZone: String,
    userId: { type: ObjectId, ref: "User" },
    enquiries: { type: Number, default: 0 },
    /** Coarse device class (desktop / mobile / tablet) and browser family — no versions, no fingerprint. */
    device: String,
    browser: String,
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
    geo: geoSchema,
    timeZone: String,
    device: String,
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

/** Beacon de-duplication: one key per client event id, kept for a week. */
const webEventKeySchema = new Schema({ key: { type: String, required: true, unique: true }, at: { type: Date, required: true } }, { timestamps: false });
webEventKeySchema.index({ at: 1 }, { expireAfterSeconds: 7 * 86_400 });
export const WebEventKey = defineModel("WebEventKey", webEventKeySchema);

/** How a visitor arrived: first ever visit (first touch) or the visit that converted (last touch). */
const touchSchema = new Schema({ at: Date, channel: String, referrerDomain: String, utm: utmSchema, landingPage: String }, { _id: false });

export const CONVERSION_TYPES = ["contact_form", "consultation_request", "client_signup"] as const;
export type ConversionType = (typeof CONVERSION_TYPES)[number];

const webConversionSchema = new Schema(
  {
    /** Idempotency key, e.g. "contact:<ContactRequest id>" — the same lead is never counted twice. */
    key: { type: String, required: true, unique: true },
    type: { type: String, enum: CONVERSION_TYPES, required: true },
    at: { type: Date, required: true },
    /** Calendar day in the reporting time zone (Europe/Oslo). */
    day: { type: String, required: true },
    /** Only for browsers that accepted analytics; otherwise the conversion is counted but unattributed. */
    consented: { type: Boolean, required: true },
    visitorId: { type: ObjectId, ref: "WebVisitor" },
    sessionId: { type: ObjectId, ref: "WebSession" },
    /** The lead's own record — details the visitor provided themselves. */
    contactRequestId: { type: ObjectId, ref: "ContactRequest" },
    userId: { type: ObjectId, ref: "User" },
    serviceSlug: String,
    firstTouch: touchSchema,
    lastTouch: touchSchema,
  },
  { timestamps: false },
);
webConversionSchema.index({ at: -1 });
webConversionSchema.index({ day: 1, type: 1 });
webConversionSchema.index({ visitorId: 1, at: 1 }, { sparse: true });
export const WebConversion = defineModel("WebConversion", webConversionSchema);
export type WebConversionDoc = InferSchemaType<typeof webConversionSchema> & { _id: Id };

const countRow = new Schema({ key: String, visitors: Number, sessions: Number, pageViews: Number, conversions: Number }, { _id: false });
const webAnalyticsDailySchema = new Schema(
  {
    /** "YYYY-MM-DD" in `timeZone` (Europe/Oslo). One row per day. */
    day: { type: String, required: true, unique: true },
    timeZone: { type: String, required: true },
    uniqueVisitors: { type: Number, default: 0 },
    newVisitors: { type: Number, default: 0 },
    returningVisitors: { type: Number, default: 0 },
    sessions: { type: Number, default: 0 },
    pageViews: { type: Number, default: 0 },
    /** Arrivals recorded without consent before 2026-10 (the site no longer records those). */
    cookielessVisits: { type: Number, default: 0 },
    avgSessionSeconds: { type: Number, default: 0 },
    /** Lead submissions (all contact-form enquiries and client sign-ups, consented or not). */
    leads: { type: Number, default: 0 },
    contactForms: { type: Number, default: 0 },
    consultationRequests: { type: Number, default: 0 },
    clientSignups: { type: Number, default: 0 },
    /** Tracked sessions that produced a lead. */
    convertedSessions: { type: Number, default: 0 },
    sources: { type: [countRow], default: [] },
    pages: { type: [countRow], default: [] },
    devices: { type: [countRow], default: [] },
    countries: { type: [countRow], default: [] },
    /** Frozen: a closed day is never recomputed (raw records may have expired since). */
    final: { type: Boolean, default: false },
    /** True when raw records for this day may already have expired before the first roll-up. */
    partial: { type: Boolean, default: false },
    computedAt: { type: Date, required: true },
  },
  { timestamps: false },
);
export const WebAnalyticsDaily = defineModel("WebAnalyticsDaily", webAnalyticsDailySchema);
export type WebAnalyticsDailyDoc = InferSchemaType<typeof webAnalyticsDailySchema> & { _id: Id };
