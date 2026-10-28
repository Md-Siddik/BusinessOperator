import { randomBytes } from "node:crypto";
import { Types } from "mongoose";
import { z } from "zod";
import { ContactRequest, WebConversion, WebEventKey, WebPageView, WebSession, WebVisitor, type ConversionType, type WebSessionDoc, type WebVisitorDoc } from "@/models";
import { isInternal, type Actor } from "@/lib/permissions";
import { getSetting } from "@/features/settings/service";
import { todayIn } from "@/lib/dates/country-time";
import { ANALYTICS_TIME_ZONE, browserFamily, channelFor, deviceCategory, hashVisitorId, isBot, parsePath, parseReferrer, parseUtm, SESSION_TIMEOUT_MS, VISITOR_ID_RE, visitorLabel } from "./classify";
import { validTimeZone, type Geo } from "./geo";

/**
 * Collection side of website analytics (public tracker → /api/track). Never throws to the
 * caller's page: the route swallows failures, and the tracker ignores the response.
 *
 * Only browsers with a valid "granted" consent decision are recorded (lib/consent): the tracker
 * sends nothing before a decision or after "Deny", and this function refuses such events anyway.
 * With consent the browser's random cookie id (HMAC-hashed here) groups page views into visitors
 * and sessions. A client event id makes every beacon idempotent (retries are counted once).
 */

const landingSchema = z.object({ url: z.string().max(2000), referrer: z.string().max(2000).nullish() });
const trackSchema = z.object({
  type: z.enum(["pageview", "ping"]).default("pageview"),
  url: z.string().max(2000),
  referrer: z.string().max(2000).nullish(),
  webdriver: z.boolean().optional(),
  /** After "Accept": the cookieless record of this same page, replaced by a consented one. */
  replaces: z.string().max(40).optional(),
  /** After "Accept": how this tab arrived on the site, so the visit keeps its source/campaign. */
  landing: landingSchema.optional(),
  /** The browser's IANA time zone, to show the visit in the visitor's local time. */
  tz: z.string().max(64).optional(),
  /** Random id of this beacon, generated once per page view: a retried request is counted once. */
  eventId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
});

export type TrackContext = {
  userAgent?: string | null;
  /** Host of the site (to tell internal navigation from referrals). */
  host: string;
  /** The visitor accepted analytics (et_consent cookie). */
  consent: boolean;
  /** Raw et_vid cookie value, if any. */
  vid?: string | null;
  actor?: Actor | null;
  now?: Date;
  /** Coarse location for this request; only called for page views that are recorded. */
  resolveGeo?: () => Promise<Geo | null>;
};
export type TrackResult = { recorded: boolean; reason?: string; /** A newly issued visitor id to set as cookie. */ newVid?: string; id?: string };

const validVid = (vid: string | null | undefined) => (vid && VISITOR_ID_RE.test(vid) ? vid : undefined);

async function expiry(now: Date) {
  const { retentionDays } = await getSetting("analytics");
  return new Date(now.getTime() + retentionDays * 86_400_000);
}

export async function recordEvent(input: unknown, ctx: TrackContext): Promise<TrackResult> {
  const parsed = trackSchema.safeParse(input);
  if (!parsed.success) return { recorded: false, reason: "invalid" };
  const data = parsed.data;
  if (isBot(ctx.userAgent, data.webdriver)) return { recorded: false, reason: "bot" };
  // The team's own browsing is not marketing traffic.
  if (isInternal(ctx.actor)) return { recorded: false, reason: "internal" };
  // Optional analytics needs a valid "granted" decision — nothing at all is stored without it.
  if (!ctx.consent) return { recorded: false, reason: "no-consent" };
  const now = ctx.now ?? new Date();
  const vid = ctx.consent ? validVid(ctx.vid) : undefined;

  if (data.type === "ping") {
    if (!vid) return { recorded: false, reason: "no-session" };
    return { recorded: await extendSession(vid, now) };
  }

  const loc = parsePath(data.url);
  if (!loc) return { recorded: false, reason: "path" };
  const ref = parseReferrer(data.referrer, ctx.host);
  const utm = parseUtm(loc.search);
  const expireAt = await expiry(now);
  const geo = (await ctx.resolveGeo?.().catch(() => null)) ?? undefined;
  const timeZone = validTimeZone(data.tz);
  const device = deviceCategory(ctx.userAgent);
  const base = { at: now, path: loc.path, page: loc.page, locale: loc.locale, serviceSlug: loc.serviceSlug, geo, timeZone, device, expireAt };

  if (data.eventId) {
    try {
      await WebEventKey.create({ key: `pv:${data.eventId}`, at: now });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) return { recorded: false, reason: "duplicate" };
      throw e;
    }
  }

  // Attribution comes from how this tab arrived (after "Accept"), otherwise from this page.
  const land = data.landing ? { loc: parsePath(data.landing.url), ref: parseReferrer(data.landing.referrer, ctx.host) } : null;
  const aUtm = land?.loc ? parseUtm(land.loc.search) : utm;
  const aRef = land?.loc ? land.ref : ref;
  const aPage = land?.loc?.page ?? loc.page;
  const external = !aRef.internal;
  const channel = external ? channelFor(aUtm, aRef.referrerDomain) : "direct";

  if (data.replaces && Types.ObjectId.isValid(data.replaces)) {
    await WebPageView.deleteOne({ _id: data.replaces, consented: false, path: loc.path, at: { $gte: new Date(now.getTime() - SESSION_TIMEOUT_MS) } });
  }

  const newVid = vid ? undefined : randomBytes(18).toString("base64url");
  const vidHash = hashVisitorId(vid ?? newVid!);
  const userId = ctx.actor?.role === "CLIENT" ? new Types.ObjectId(ctx.actor.id) : undefined;

  const visitor = (await WebVisitor.findOneAndUpdate(
    { vidHash },
    {
      $setOnInsert: { vidHash, label: visitorLabel(vidHash), firstSeen: now, firstChannel: channel, firstReferrerDomain: aRef.referrerDomain, firstUtm: aUtm, firstLandingPage: aPage },
      $set: { lastSeen: now, expireAt, ...(geo && { geo }), ...(timeZone && { timeZone }), ...(userId && { userId, userRole: "CLIENT" }) },
      $inc: { pageViews: 1 },
    },
    { upsert: true, new: true },
  ).lean<WebVisitorDoc>())!;

  let session = await WebSession.findOne({ visitorId: visitor._id, lastSeen: { $gte: new Date(now.getTime() - SESSION_TIMEOUT_MS) } })
    .sort({ lastSeen: -1 })
    .lean<WebSessionDoc>();
  // A new campaign arriving mid-visit starts a new session, so each campaign gets its own credit.
  if (session && external && aUtm?.campaign && aUtm.campaign !== session.utm?.campaign) session = null;

  let isNew = false;
  if (session) {
    await WebSession.updateOne({ _id: session._id }, { $set: { lastSeen: now, exitPage: loc.page, expireAt, ...(userId && { userId }) }, $inc: { pageViews: 1 } });
  } else {
    isNew = true;
    const v = await WebVisitor.findOneAndUpdate({ _id: visitor._id }, { $inc: { sessions: 1 } }, { new: true }).select("sessions").lean<{ sessions: number }>();
    session = (
      await WebSession.create({
        visitorId: visitor._id,
        sessionNo: v?.sessions ?? 1,
        startedAt: now,
        lastSeen: now,
        pageViews: 1,
        landingPage: aPage,
        exitPage: loc.page,
        channel,
        referrer: aRef.referrer,
        referrerDomain: aRef.referrerDomain,
        utm: external ? aUtm : undefined,
        geo,
        timeZone,
        userId,
        device,
        browser: browserFamily(ctx.userAgent),
        expireAt,
      })
    ).toObject() as WebSessionDoc;
  }

  await WebPageView.create({ ...base, consented: true, visitorId: visitor._id, sessionId: session._id, entry: isNew, channel: session.channel, referrerDomain: session.referrerDomain, utm: session.utm });
  return { recorded: true, newVid };
}

/** Sent when the tab is hidden: keeps the session's end time (and so its duration) accurate. */
async function extendSession(vid: string, now: Date) {
  const visitor = await WebVisitor.findOne({ vidHash: hashVisitorId(vid) }).select("_id").lean<{ _id: Types.ObjectId }>();
  if (!visitor) return false;
  const res = await WebSession.updateOne({ visitorId: visitor._id, lastSeen: { $gte: new Date(now.getTime() - SESSION_TIMEOUT_MS) } }, { $set: { lastSeen: now } });
  return res.modifiedCount > 0;
}

async function visitorFor(vid: string | null | undefined) {
  const v = validVid(vid);
  if (!v) return null;
  return WebVisitor.findOne({ vidHash: hashVisitorId(v) }).select("_id convertedAt").lean<{ _id: Types.ObjectId; convertedAt?: Date }>();
}

/**
 * The visitor submitted the contact form: their earlier anonymous activity now belongs to
 * that enquiry (a voluntary, first-party identification). Only browsers that accepted analytics.
 */
export async function linkVisitorToEnquiry(vid: string | null | undefined, contactRequestId: unknown, now = new Date()) {
  const visitor = await visitorFor(vid);
  if (!visitor || !Types.ObjectId.isValid(String(contactRequestId))) return false;
  await WebVisitor.updateOne({ _id: visitor._id }, { $addToSet: { contactRequestIds: contactRequestId }, ...(!visitor.convertedAt && { $set: { convertedAt: now } }) });
  await WebSession.findOneAndUpdate({ visitorId: visitor._id }, { $inc: { enquiries: 1 } }, { sort: { lastSeen: -1 } });
  return true;
}

type Touch = { at?: Date | null; channel?: string | null; referrerDomain?: string | null; utm?: { source?: string | null; medium?: string | null; campaign?: string | null } | null; landingPage?: string | null };

export type ConversionInput = {
  type: ConversionType;
  /** Idempotency key: the same lead is never counted twice (e.g. "contact:<id>"). */
  key: string;
  /** Raw et_vid cookie — pass it only when the browser has a valid "granted" decision. */
  vid?: string | null;
  contactRequestId?: string;
  userId?: string;
  serviceSlug?: string | null;
  now?: Date;
};

/**
 * Record a lead submission. Every lead is counted (it is our own record, not tracking); first-
 * and last-touch attribution is added only for a browser that accepted analytics, and is copied
 * onto the enquiry. Unknown visitors stay anonymous — nothing is inferred from technical signals.
 */
export async function recordConversion(input: ConversionInput) {
  const now = input.now ?? new Date();
  const visitor = input.vid ? await WebVisitor.findOne({ vidHash: hashVisitorId(validVid(input.vid) ?? "") }).lean<WebVisitorDoc>() : null;
  const session = visitor ? await WebSession.findOne({ visitorId: visitor._id }).sort({ lastSeen: -1 }).lean<WebSessionDoc>() : null;
  const firstTouch: Touch | undefined = visitor ? { at: visitor.firstSeen, channel: visitor.firstChannel, referrerDomain: visitor.firstReferrerDomain, utm: visitor.firstUtm, landingPage: visitor.firstLandingPage } : undefined;
  const lastTouch: Touch | undefined = session ? { at: session.startedAt, channel: session.channel, referrerDomain: session.referrerDomain, utm: session.utm, landingPage: session.landingPage } : undefined;
  const res = await WebConversion.updateOne(
    { key: input.key },
    {
      $setOnInsert: {
        key: input.key,
        type: input.type,
        at: now,
        day: todayIn(ANALYTICS_TIME_ZONE, now),
        consented: !!visitor,
        visitorId: visitor?._id,
        sessionId: session?._id,
        contactRequestId: input.contactRequestId && Types.ObjectId.isValid(input.contactRequestId) ? new Types.ObjectId(input.contactRequestId) : undefined,
        userId: input.userId && Types.ObjectId.isValid(input.userId) ? new Types.ObjectId(input.userId) : undefined,
        serviceSlug: input.serviceSlug ?? undefined,
        firstTouch,
        lastTouch,
      },
    },
    { upsert: true },
  );
  const created = res.upsertedCount > 0;
  if (created && visitor && input.contactRequestId && Types.ObjectId.isValid(input.contactRequestId)) {
    const flat = (t?: Touch) => t && { at: t.at, channel: t.channel, referrerDomain: t.referrerDomain, source: t.utm?.source, medium: t.utm?.medium, campaign: t.utm?.campaign, landingPage: t.landingPage };
    await ContactRequest.updateOne({ _id: input.contactRequestId, attribution: { $exists: false } }, { $set: { attribution: { conversionType: input.type, visitorLabel: visitor.label, firstTouch: flat(firstTouch), lastTouch: flat(lastTouch) } } });
  }
  return { created, attributed: !!visitor };
}

/** A contact-form enquiry asking for a phone or video call is a consultation request. */
export function enquiryConversionType(preferredContact: string | null | undefined): ConversionType {
  return preferredContact === "phone" || preferredContact === "video" ? "consultation_request" : "contact_form";
}

/** A CLIENT logged in on this browser: associate the anonymous visitor with the account. */
export async function linkVisitorToUser(vid: string | null | undefined, user: { id: string; role: string }) {
  if (user.role !== "CLIENT") return false;
  const visitor = await visitorFor(vid);
  if (!visitor) return false;
  const userId = new Types.ObjectId(user.id);
  await WebVisitor.updateOne({ _id: visitor._id }, { $set: { userId, userRole: user.role } });
  await WebSession.findOneAndUpdate({ visitorId: visitor._id }, { $set: { userId } }, { sort: { lastSeen: -1 } });
  return true;
}

/** Consent withdrawn: everything recorded for this browser is deleted. */
export async function forgetVisitor(vid: string | null | undefined) {
  const v = validVid(vid);
  if (!v) return false;
  const visitor = await WebVisitor.findOne({ vidHash: hashVisitorId(v) }).select("_id").lean<{ _id: Types.ObjectId }>();
  if (!visitor) return false;
  await Promise.all([WebPageView.deleteMany({ visitorId: visitor._id }), WebSession.deleteMany({ visitorId: visitor._id }), WebVisitor.deleteOne({ _id: visitor._id })]);
  return true;
}
