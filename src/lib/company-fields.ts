/**
 * Company data-quality vocabulary shared by server and UI. Client-safe.
 */

/** Where a contact value came from. Ordered from most to least authoritative. */
export const CONTACT_SOURCE_KINDS = ["REGISTRY", "WEBSITE", "PUBLIC", "ENRICHMENT", "MANUAL"] as const;
export type ContactSourceKind = (typeof CONTACT_SOURCE_KINDS)[number];

export const CONTACT_SOURCE_LABELS: Record<ContactSourceKind, string> = {
  REGISTRY: "Official registry",
  WEBSITE: "Company website",
  PUBLIC: "Public business source",
  ENRICHMENT: "Enrichment provider",
  MANUAL: "Added manually",
};

export const RELEVANCE_VALUES = ["RELEVANT", "MAYBE", "NOT_RELEVANT"] as const;
export type Relevance = (typeof RELEVANCE_VALUES)[number];
export const RELEVANCE_LABELS: Record<Relevance, string> = { RELEVANT: "Relevant", MAYBE: "Maybe", NOT_RELEVANT: "Not relevant" };

export const CONTACT_FIELDS = ["email", "phone", "mobile", "website", "address", "person"] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];
export const CONTACT_FIELD_LABELS: Record<ContactField, string> = {
  email: "Email",
  phone: "Phone",
  mobile: "Mobile",
  website: "Website",
  address: "Address",
  person: "Contact person",
};

export type ContactInput = {
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  website?: string | null;
  address?: string | null;
  contactPerson?: { name?: string | null } | null;
};

/**
 * Data completeness for lead discovery. Weighted toward what lets you reach
 * the company: email and phone count most.
 *   email 30 · phone/mobile 25 · website 20 · address 10 · contact person 15 = 100
 * "Fully contactable" = email + (phone or mobile) + website.
 */
export function contactQuality(c: ContactInput) {
  const flags = {
    email: !!c.email,
    phone: !!c.phone,
    mobile: !!c.mobile,
    website: !!c.website,
    address: !!c.address,
    person: !!c.contactPerson?.name,
  };
  const completeness = (flags.email ? 30 : 0) + (flags.phone || flags.mobile ? 25 : 0) + (flags.website ? 20 : 0) + (flags.address ? 10 : 0) + (flags.person ? 15 : 0);
  return { flags, completeness, fullyContactable: flags.email && (flags.phone || flags.mobile) && flags.website };
}

/** 0–5 stars for display. */
export function completenessStars(completeness: number) {
  return Math.round((completeness / 100) * 5);
}

/**
 * Contact availability filters on the daily view (server-side).
 * "direct" = at least one usable, source-supported business email OR phone.
 */
export const CONTACT_FILTERS = ["email", "phone", "both", "direct", "form", "nodirect", "pending", "website", "person", "complete", "none", "verified", "researching"] as const;
export type ContactFilter = (typeof CONTACT_FILTERS)[number];
export const CONTACT_FILTER_LABELS: Record<ContactFilter, string> = {
  email: "Has email",
  phone: "Has phone",
  both: "Has both",
  direct: "Direct contact",
  form: "Contact form only",
  nodirect: "No direct contact",
  pending: "Verification pending",
  website: "Has website",
  person: "Has contact person",
  complete: "Email + phone + website",
  none: "No contact details",
  verified: "Contact verified",
  researching: "Research pending",
};
/** Chips shown on the daily view (the rest stay available via URL / saved views). */
export const PRIMARY_CONTACT_FILTERS: ContactFilter[] = ["email", "phone", "both", "website", "person", "nodirect", "researching", "verified", "form", "pending"];

/** Research states that still count as "research pending" (no final answer yet). */
export const PENDING_RESEARCH_STATUSES: ResearchStatus[] = ["NOT_STARTED", "SEARCHING", "NO_CONTACT_YET", "RETRY_SCHEDULED", "BUDGET_PAUSED", "PROVIDER_UNAVAILABLE", "RESEARCH_UNAVAILABLE"];

/* ───────────── Contact verification vocabulary ───────────── */

/** Email: where the value stands technically. Catch-all is never treated as a confirmed mailbox. */
export const EMAIL_VERIFICATION = ["SOURCE_CONFIRMED", "DELIVERABLE", "CATCH_ALL", "UNKNOWN", "INVALID", "BOUNCED"] as const;
export type EmailVerification = (typeof EMAIL_VERIFICATION)[number];
export const EMAIL_VERIFICATION_LABELS: Record<EmailVerification, string> = {
  SOURCE_CONFIRMED: "Source confirmed",
  DELIVERABLE: "Deliverability verified",
  CATCH_ALL: "Catch-all domain",
  UNKNOWN: "Unknown",
  INVALID: "Invalid",
  BOUNCED: "Bounced",
};

/** Phone: published is not the same as reachable. Formatting alone proves nothing. */
export const PHONE_VERIFICATION = ["PUBLISHED", "REACHABILITY_CONFIRMED", "INVALID"] as const;
export type PhoneVerification = (typeof PHONE_VERIFICATION)[number];
export const PHONE_VERIFICATION_LABELS: Record<PhoneVerification, string> = {
  PUBLISHED: "Published business number",
  REACHABILITY_CONFIRMED: "Reachability confirmed",
  INVALID: "Invalid",
};

/** Does this contact belong to this legal entity? */
export const CONTACT_OWNERSHIP = ["CONFIRMED", "LIKELY", "UNCERTAIN", "INTERMEDIARY", "GROUP_LEVEL"] as const;
export type ContactOwnership = (typeof CONTACT_OWNERSHIP)[number];
export const CONTACT_OWNERSHIP_LABELS: Record<ContactOwnership, string> = {
  CONFIRMED: "Belongs to this company",
  LIKELY: "Likely this company",
  UNCERTAIN: "Uncertain — needs review",
  INTERMEDIARY: "Intermediary (agent / accountant / registered office)",
  GROUP_LEVEL: "Group-level route",
};

export const CONTACT_PURPOSES = ["GENERAL", "NO_REPLY", "RESTRICTED_PURPOSE", "PLACEHOLDER", "MASKED"] as const;
export type ContactPurpose = (typeof CONTACT_PURPOSES)[number];

export const REVIEW_STATES = ["NONE", "PENDING", "APPROVED", "REJECTED"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

/* ───────────── Research status ───────────── */

export const RESEARCH_STATUSES = [
  "NOT_STARTED",
  "SEARCHING",
  "CONTACTS_FOUND",
  "PARTIAL",
  "VERIFICATION_PENDING",
  "NO_CONTACT_YET",
  "RETRY_SCHEDULED",
  "BUDGET_PAUSED",
  "PROVIDER_UNAVAILABLE",
  "RESEARCH_UNAVAILABLE",
  "EXHAUSTED",
] as const;
export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];
export const RESEARCH_STATUS_LABELS: Record<ResearchStatus, string> = {
  NOT_STARTED: "Not researched yet",
  SEARCHING: "Searching",
  CONTACTS_FOUND: "Contacts found",
  PARTIAL: "Partial contacts",
  VERIFICATION_PENDING: "Verification pending",
  NO_CONTACT_YET: "No contact found yet",
  RETRY_SCHEDULED: "Retry scheduled",
  BUDGET_PAUSED: "Budget paused",
  PROVIDER_UNAVAILABLE: "Provider unavailable",
  RESEARCH_UNAVAILABLE: "Research unavailable (website could not be accessed safely)",
  EXHAUSTED: "Research exhausted",
};

/* ───────────── Outreach eligibility (separate from availability) ───────────── */

export const ELIGIBILITY_STATES = ["NEEDS_REVIEW", "CLEARED", "RESTRICTED", "DO_NOT_CONTACT"] as const;
export type EligibilityState = (typeof ELIGIBILITY_STATES)[number];
export const ELIGIBILITY_LABELS: Record<EligibilityState, string> = {
  NEEDS_REVIEW: "Needs review",
  CLEARED: "Review cleared",
  RESTRICTED: "Restricted",
  DO_NOT_CONTACT: "Do not contact",
};

/* ───────────── Value classification ───────────── */

const NO_REPLY = /^(no-?reply|do-?not-?reply|donotreply|noreply|mailer-daemon|postmaster|bounce)/i;
const RESTRICTED_LOCAL = /^(invoice|invoices|faktura|fakturor|lasku|laskut|rechnung|billing|accounts?payable|ap|privacy|gdpr|dpo|abuse|security|legal|press|presse|jobs|careers|recruit(ing|ment)?|hr|ehf|einvoice|e-invoice)$/i;
const PLACEHOLDER_EMAIL = /(@example\.(com|org|net)$|^test@|^email@|^name@|^your(name|email)?@|@domain\.(com|tld)$|@email\.com$)/i;
/** Registry / dataset administrator domains — never a company's own contact. */
export const REGISTRY_ADMIN_DOMAINS = ["brreg.no", "prh.fi", "ytj.fi", "companieshouse.gov.uk", "company-information.service.gov.uk", "cro.ie", "rik.ee", "kvk.nl", "insee.fr", "virk.dk", "erst.dk", "bolagsverket.se", "scb.se", "handelsregister.de"];

/** Classify a raw value: placeholders, masked and no-reply values never count as usable contacts. */
export function classifyContactValue(type: "EMAIL" | "PHONE" | "MOBILE", value: string): { purpose: ContactPurpose; usable: boolean; reason?: string } {
  const v = value.trim();
  if (!v || /[*•]{2,}|x{4,}|\.\.\./i.test(v)) return { purpose: "MASKED", usable: false, reason: "Masked or truncated value" };
  if (type === "EMAIL") {
    const [local = "", domain = ""] = v.toLowerCase().split("@");
    if (!domain || PLACEHOLDER_EMAIL.test(v)) return { purpose: "PLACEHOLDER", usable: false, reason: "Placeholder address" };
    if (REGISTRY_ADMIN_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return { purpose: "PLACEHOLDER", usable: false, reason: "Registry / administrator address, not the company's" };
    if (NO_REPLY.test(local)) return { purpose: "NO_REPLY", usable: false, reason: "No-reply address" };
    if (RESTRICTED_LOCAL.test(local)) return { purpose: "RESTRICTED_PURPOSE", usable: false, reason: `Purpose-restricted address (${local}@)` };
    return { purpose: "GENERAL", usable: true };
  }
  const digits = v.replace(/\D/g, "");
  if (digits.length < 7 || /^(\d)\1+$/.test(digits) || /(\d)\1{6,}/.test(digits) || /^(0123456|1234567)/.test(digits)) return { purpose: "PLACEHOLDER", usable: false, reason: "Not a plausible phone number" };
  return { purpose: "GENERAL", usable: true };
}

/** Public webmail domains: allowed when the source shows the company publishes them. */
export const WEBMAIL_DOMAINS = ["gmail.com", "googlemail.com", "hotmail.com", "outlook.com", "live.com", "yahoo.com", "icloud.com", "me.com", "online.no", "live.no", "hotmail.no", "telia.com", "hotmail.se", "gmx.de", "gmx.net", "web.de", "t-online.de", "orange.fr", "wanadoo.fr", "free.fr", "laposte.net", "yahoo.fr", "eircom.net"];
export function isWebmail(email: string) {
  return WEBMAIL_DOMAINS.includes(email.split("@")[1]?.toLowerCase() ?? "");
}

/**
 * International dialing codes of the countries Company Intelligence covers (plus common
 * neighbours), longest first so "+358" never matches as "+35". Display only — stored values
 * stay E.164 ("+4791234567") so copy, tel: links and exports keep the exact number.
 */
const CALLING_CODES = ["420", "421", "353", "354", "358", "370", "371", "372", "852", "886", "966", "971", "974", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43", "44", "45", "46", "47", "48", "49", "61", "64", "65", "81", "82", "1"].sort((a, b) => b.length - a.length);

const group = (s: string, sizes: number[]) => {
  const out: string[] = [];
  let i = 0;
  for (const n of sizes) {
    if (i >= s.length) break;
    out.push(s.slice(i, i + n));
    i += n;
  }
  if (i < s.length) out.push(s.slice(i));
  return out.join(" ");
};

/** National digit grouping per calling code (common conventions; unknown lengths fall back to 3-digit groups). */
function groupNational(cc: string, n: string) {
  switch (cc) {
    case "1": // NANP: (area) exchange-line
      return n.length === 10 ? `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}` : null;
    case "61": // Australia: mobiles 4xx xxx xxx, 13/1300/1800 numbers, landlines x xxxx xxxx
      if (n.length === 9 && n.startsWith("4")) return group(n, [3, 3, 3]);
      if (/^1[38]00/.test(n) && n.length === 10) return group(n, [4, 3, 3]);
      if (n.length === 9) return group(n, [1, 4, 4]);
      return null;
    case "47":
      return n.length === 8 ? group(n, [3, 2, 3]) : null;
    case "45":
      return n.length === 8 ? group(n, [2, 2, 2, 2]) : null;
    case "44": // UK: London 20 xxxx xxxx, mobiles 7xxx xxxxxx, others xxxx xxxxxx
      if (n.length !== 10) return null;
      if (n.startsWith("20")) return group(n, [2, 4, 4]);
      return group(n, [4, 6]);
    case "33":
      return n.length === 9 ? group(n, [1, 2, 2, 2, 2]) : null;
    case "48":
    case "420":
    case "421":
      return n.length === 9 ? group(n, [3, 3, 3]) : null;
    case "353":
      return n.length === 9 ? (n.startsWith("8") ? group(n, [2, 3, 4]) : group(n, [1, 3, 4])) : null;
    case "81":
      return n.length === 10 ? group(n, [2, 4, 4]) : null;
    default:
      return null;
  }
}

/** Format a stored E.164 phone number for display: "+47 912 34 567", "+1 212 555 0100", "+61 2 9374 4000". */
export function formatPhone(value: string | undefined | null) {
  if (!value) return "";
  const m = value.match(/^\+(\d{7,15})$/);
  if (!m) return value;
  const d = m[1]!;
  const cc = CALLING_CODES.find((c) => d.startsWith(c));
  if (!cc) return value;
  const national = d.slice(cc.length);
  return `+${cc} ${groupNational(cc, national) ?? group(national, Array(Math.ceil(national.length / 3)).fill(3))}`;
}

/** Display form of a website: "example.no" (no scheme, no trailing slash). */
export function displayWebsite(value: string | undefined | null) {
  if (!value) return "";
  return value.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

/* ───────────── Contact Status (one value per company) ───────────── */

/**
 * Plain-language contact status, derived from the provenance store (never stored separately):
 *  VERIFIED               — a usable direct email whose deliverability was checked, or a phone whose reachability was confirmed
 *  UNVERIFIED             — a usable, source-supported direct email or phone that hasn't been verified yet
 *  NEEDS_REVIEW           — no usable direct contact yet, but found values wait in the review queue
 *  NOT_PUBLICLY_AVAILABLE — research has run and found no public business email or phone (not proof none exists)
 *  PENDING                — not researched yet
 */
export const CONTACT_STATUSES = ["VERIFIED", "UNVERIFIED", "NEEDS_REVIEW", "NOT_PUBLICLY_AVAILABLE", "PENDING"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];
export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  VERIFIED: "Verified",
  UNVERIFIED: "Unverified",
  NEEDS_REVIEW: "Needs Review",
  NOT_PUBLICLY_AVAILABLE: "Not Publicly Available",
  PENDING: "Research pending",
};

type ContactStatusInput = {
  direct: { has: boolean; emailVerification?: string | null; phoneVerification?: string | null; pendingVerification?: boolean };
  research: { status?: string | null; attempts?: number | null };
  pendingReview?: boolean;
};

export function contactStatusOf(c: ContactStatusInput): ContactStatus {
  if (c.direct.has) return c.direct.emailVerification === "DELIVERABLE" || c.direct.phoneVerification === "REACHABILITY_CONFIRMED" ? "VERIFIED" : "UNVERIFIED";
  if (c.direct.pendingVerification || c.pendingReview) return "NEEDS_REVIEW";
  const status = c.research.status ?? "NOT_STARTED";
  if ((c.research.attempts ?? 0) > 0 && status !== "NOT_STARTED" && status !== "SEARCHING") return "NOT_PUBLICLY_AVAILABLE";
  return "PENDING";
}

/** The same rules as database filters (server-side filtering before pagination). */
export function contactStatusFilter(s: ContactStatus): Record<string, unknown> {
  const verified = { $or: [{ "directContact.emailVerification": "DELIVERABLE" }, { "directContact.phoneVerification": "REACHABILITY_CONFIRMED" }] };
  switch (s) {
    case "VERIFIED":
      return { "directContact.has": true, ...verified };
    case "UNVERIFIED":
      return { "directContact.has": true, "directContact.emailVerification": { $ne: "DELIVERABLE" }, "directContact.phoneVerification": { $ne: "REACHABILITY_CONFIRMED" } };
    case "NEEDS_REVIEW":
      return { "directContact.has": { $ne: true }, "directContact.pendingVerification": true };
    case "NOT_PUBLICLY_AVAILABLE":
      return { "directContact.has": { $ne: true }, "directContact.pendingVerification": { $ne: true }, "research.attempts": { $gt: 0 }, "research.status": { $nin: ["NOT_STARTED", "SEARCHING"] } };
    case "PENDING":
      return { "directContact.has": { $ne: true }, "directContact.pendingVerification": { $ne: true }, $or: [{ "research.attempts": { $in: [0, null] } }, { "research.status": { $in: ["NOT_STARTED", "SEARCHING", null] } }] };
  }
}
