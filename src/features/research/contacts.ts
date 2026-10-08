import "server-only";
import type { Types } from "mongoose";
import { Company, Contact, type CompanyDoc, type ContactDoc } from "@/models";
import { classifyContactValue, contactQuality, isWebmail, type ContactOwnership, type ContactSourceKind, type EmailVerification, type PhoneVerification } from "@/lib/company-fields";

/**
 * Contact provenance + direct-contact ranking.
 *
 * A company is in the DIRECT-CONTACT group when it has at least one email or
 * phone that is (a) source-supported, (b) owned by this company (not an
 * intermediary / unresolved match), (c) not placeholder / masked / no-reply /
 * purpose-restricted and (d) not known invalid. Either email or phone qualifies.
 * Websites, addresses, social profiles, names and contact forms alone do not.
 */

export type ContactInput = {
  type: "EMAIL" | "PHONE" | "MOBILE" | "WEBSITE" | "CONTACT_PERSON" | "CONTACT_FORM";
  value: string;
  sourceKind: ContactSourceKind;
  source: string;
  sourceUrl?: string;
  provider?: string;
  ownership?: ContactOwnership;
  emailVerification?: EmailVerification;
  phoneVerification?: PhoneVerification;
  role?: string;
  personName?: string;
  providerConfidence?: number;
  evidence?: { kind: string; detail: string; url?: string }[];
  /** Send to the review queue instead of counting as direct contact. */
  needsReview?: boolean;
};

const DIRECT_OWNERSHIP: ContactOwnership[] = ["CONFIRMED", "LIKELY"];

/** Is this stored contact a usable direct channel? */
export function isDirectChannel(c: Pick<ContactDoc, "type" | "usable" | "ownership" | "review" | "emailVerification" | "phoneVerification">) {
  if (c.type !== "EMAIL" && c.type !== "PHONE" && c.type !== "MOBILE") return false;
  if (!c.usable || c.review === "PENDING" || c.review === "REJECTED") return false;
  if (!DIRECT_OWNERSHIP.includes((c.ownership ?? "CONFIRMED") as ContactOwnership) && c.review !== "APPROVED") return false;
  if (c.emailVerification === "INVALID" || c.emailVerification === "BOUNCED" || c.phoneVerification === "INVALID") return false;
  return true;
}

const EMAIL_SCORE: Record<string, number> = { DELIVERABLE: 60, SOURCE_CONFIRMED: 45, UNKNOWN: 35, CATCH_ALL: 30 };
const PHONE_SCORE: Record<string, number> = { REACHABILITY_CONFIRMED: 55, PUBLISHED: 40 };

function channelScore(c: ContactDoc) {
  let s = c.type === "EMAIL" ? (EMAIL_SCORE[c.emailVerification ?? "UNKNOWN"] ?? 30) : (PHONE_SCORE[c.phoneVerification ?? "PUBLISHED"] ?? 35);
  if (c.ownership === "LIKELY" && c.review !== "APPROVED") s -= 10;
  if (c.sourceKind === "REGISTRY") s += 5;
  return s;
}

/** Upsert one attributable contact value with its classification. Returns the stored doc. */
export async function recordContact(company: { _id: Types.ObjectId | string; countryCode: string; isDemo?: boolean | null }, input: ContactInput) {
  const now = new Date();
  let usable = true;
  let unusableReason: string | undefined;
  let purpose: string = "GENERAL";
  if (input.type === "EMAIL" || input.type === "PHONE" || input.type === "MOBILE") {
    const cls = classifyContactValue(input.type, input.value);
    usable = cls.usable;
    unusableReason = cls.reason;
    purpose = cls.purpose;
  }
  let ownership: ContactOwnership = input.ownership ?? (input.sourceKind === "REGISTRY" || input.sourceKind === "MANUAL" ? "CONFIRMED" : "LIKELY");
  // A webmail address from an enrichment provider has no domain evidence of ownership.
  if (input.type === "EMAIL" && isWebmail(input.value) && input.sourceKind === "ENRICHMENT" && !input.ownership) ownership = "UNCERTAIN";
  const review = input.needsReview || ownership === "UNCERTAIN" ? "PENDING" : undefined;

  const existing = await Contact.findOne({ companyId: company._id, type: input.type, value: input.value }).lean<ContactDoc>();
  // Never downgrade a stronger existing source (registry/manual) with a weaker one.
  const keepSource = existing && (existing.sourceKind === "REGISTRY" || existing.sourceKind === "MANUAL") && input.sourceKind !== existing.sourceKind;
  const set: Record<string, unknown> = {
    countryCode: company.countryCode,
    lastSeenAt: now,
    purpose,
    usable,
    unusableReason,
    isDemo: !!company.isDemo,
    ...(input.role && { role: input.role }),
    ...(input.personName && { personName: input.personName }),
    ...(input.providerConfidence !== undefined && { providerConfidence: input.providerConfidence }),
  };
  if (!keepSource) {
    Object.assign(set, { sourceKind: input.sourceKind, source: input.source, sourceUrl: input.sourceUrl, provider: input.provider });
    // Keep a reviewer's decision on ownership.
    if (!existing || existing.review === "NONE" || existing.review === "PENDING") set.ownership = ownership;
  }
  if (input.emailVerification) set.emailVerification = input.emailVerification;
  else if (input.type === "EMAIL" && !existing?.emailVerification) set.emailVerification = input.sourceKind === "REGISTRY" || input.sourceKind === "WEBSITE" ? "SOURCE_CONFIRMED" : "UNKNOWN";
  if (input.phoneVerification) set.phoneVerification = input.phoneVerification;
  else if ((input.type === "PHONE" || input.type === "MOBILE") && !existing?.phoneVerification) set.phoneVerification = "PUBLISHED";
  if (review && (!existing || existing.review === "NONE")) set.review = review;
  const evidence = (input.evidence ?? []).map((e) => ({ ...e, at: now }));

  await Contact.updateOne(
    { companyId: company._id, type: input.type, value: input.value },
    {
      $set: set,
      $setOnInsert: { companyId: company._id, type: input.type, value: input.value, collectedAt: now },
      ...(evidence.length && { $push: { evidence: { $each: evidence, $slice: -20 } } }),
    },
    { upsert: true },
  );
  return Contact.findOne({ companyId: company._id, type: input.type, value: input.value }).lean<ContactDoc>();
}

/**
 * A contact value shared by several unrelated companies is most likely an
 * intermediary (formation agent, accountant, registered-office provider).
 * Such values are kept but never counted as the company's own direct contact.
 */
export async function flagSharedContacts(values: string[], threshold = Number(process.env.SHARED_CONTACT_THRESHOLD || 3)) {
  if (!values.length) return [];
  const shared = await Contact.aggregate<{ _id: string; companies: Types.ObjectId[] }>([
    { $match: { value: { $in: [...new Set(values)] }, type: { $in: ["EMAIL", "PHONE", "MOBILE"] } } },
    { $group: { _id: "$value", companies: { $addToSet: "$companyId" } } },
    { $match: { [`companies.${threshold - 1}`]: { $exists: true } } },
  ]);
  for (const s of shared) {
    await Contact.updateMany(
      { value: s._id, review: { $ne: "APPROVED" } },
      { $set: { ownership: "INTERMEDIARY" }, $push: { evidence: { kind: "SHARED_VALUE", detail: `Used by ${s.companies.length} different companies — likely an intermediary (agent, accountant or registered office).`, at: new Date() } } },
    );
  }
  const affected = shared.flatMap((s) => s.companies);
  for (const id of affected) await recomputeCompanyContacts(id);
  return shared.map((s) => s._id);
}

/**
 * Recompute direct-contact ranking, flags and primary values for one company.
 * Returns whether the company just became contactable (for the inbox / live updates).
 */
export async function recomputeCompanyContacts(companyId: Types.ObjectId | string) {
  const company = await Company.findById(companyId).lean<CompanyDoc>();
  if (!company) return { becameContactable: false };
  const contacts = await Contact.find({ companyId: company._id }).lean<ContactDoc[]>();
  const direct = contacts.filter(isDirectChannel);
  const emails = direct.filter((c) => c.type === "EMAIL").sort((a, b) => channelScore(b) - channelScore(a));
  const phones = direct.filter((c) => c.type !== "EMAIL").sort((a, b) => channelScore(b) - channelScore(a));
  const bestEmail = emails[0];
  const bestPhone = phones[0];
  const has = !!bestEmail || !!bestPhone;
  const quality = has ? Math.min(100, Math.max(bestEmail ? channelScore(bestEmail) : 0, bestPhone ? channelScore(bestPhone) : 0) + (bestEmail && bestPhone ? 20 : 0)) : 0;
  const form = contacts.find((c) => c.type === "CONTACT_FORM" && c.review !== "REJECTED");
  const pendingVerification = (!!bestEmail && ["SOURCE_CONFIRMED", "UNKNOWN"].includes(bestEmail.emailVerification ?? "UNKNOWN")) || contacts.some((c) => c.review === "PENDING");

  const set: Record<string, unknown> = {
    "directContact.has": has,
    "directContact.hasEmail": !!bestEmail,
    "directContact.hasPhone": !!bestPhone,
    "directContact.quality": quality,
    "directContact.pendingVerification": pendingVerification,
    "directContact.formOnly": !has && !!form,
    "directContact.emailVerification": bestEmail?.emailVerification,
    "directContact.phoneVerification": bestPhone?.phoneVerification,
  };
  if (form) set.contactFormUrl = form.value;

  // Fill empty primary values from the best usable channel (never overwrite registry/manual values).
  const primary = { email: company.email, phone: company.phone, mobile: company.mobile, website: company.website };
  const fill = (field: "email" | "phone", c: ContactDoc | undefined) => {
    if (!c || primary[field]) return;
    primary[field] = c.value;
    set[field] = c.value;
    set[`contactSources.${field}`] = { kind: c.sourceKind, source: c.source, url: c.sourceUrl, at: c.collectedAt ?? new Date(), verified: c.emailVerification === "DELIVERABLE" };
  };
  fill("email", bestEmail);
  fill("phone", phones.find((p) => p.type === "PHONE") ?? (primary.mobile ? undefined : bestPhone));
  if (!primary.website) {
    const site = contacts.find((c) => c.type === "WEBSITE" && c.ownership === "CONFIRMED" && c.review !== "PENDING" && c.review !== "REJECTED");
    if (site) {
      primary.website = site.value;
      set.website = site.value;
      set["contactSources.website"] = { kind: site.sourceKind, source: site.source, url: site.sourceUrl, at: site.collectedAt ?? new Date(), verified: true };
    }
  }
  const q = contactQuality({ ...primary, address: company.address ?? company.city, contactPerson: company.contactPerson });
  set.contactFlags = q.flags;
  set.completeness = q.completeness;
  set.fullyContactable = q.fullyContactable;

  const becameContactable = has && !company.directContact?.has;
  if (has && !company.contactFoundAt) set.contactFoundAt = new Date();
  const lastVerified = direct.map((c) => c.verifiedAt ?? (c.emailVerification === "DELIVERABLE" ? c.updatedAt : undefined)).filter(Boolean).sort().pop();
  if (lastVerified) set.contactLastVerifiedAt = lastVerified;
  await Company.updateOne({ _id: company._id }, { $set: set });
  return { becameContactable, has, quality };
}
