import { OFFICIAL_SOURCE_CLASSES, type ActivityStatus, type ContactRoute, type EmployerIdentity, type SourceClass, type VerificationLabel } from "./constants";
import { emailDomain, hostOf, isGenericHost, registrableDomain } from "./normalize";

/**
 * Pure derivation rules for the trust model (unit-tested). Every label is derived
 * from stored evidence — nothing here invents data or upgrades a record without a basis.
 */

/** How the source itself was verified (separate from employer identity and activity). */
export type SourceVerificationStatus =
  /** Authoritative API of a public body (procurement portal, public employment service). */
  | "AUTHORITATIVE_SOURCE"
  /** ATS board linked from the employer's official website (checked). */
  | "LINKED_FROM_OFFICIAL_DOMAIN"
  /** Published on the employer's official domain itself. */
  | "ON_OFFICIAL_DOMAIN"
  /** ATS board configured, but no link from the official website was found. */
  | "LINK_NOT_FOUND"
  | "NOT_CHECKED"
  | "AGGREGATOR";

export type DerivableRecord = {
  type?: string | null;
  sourceClass: SourceClass;
  sourceVerification?: { status?: string | null } | null;
  employerIdentity?: EmployerIdentity | string | null;
  sourceState?: string | null;
  sourceSaysClosed?: boolean | null;
  deadline?: Date | null;
  lastSeenAt?: Date | null;
  consecutiveCheckFailures?: number | null;
  manualVerification?: { result?: string | null } | null;
  organization?: { name?: string | null } | null;
};

/**
 * Activity status from evidence (definitions in constants.ts):
 *  removed/closed at source → CLOSED; published deadline passed → EXPIRED;
 *  confirmed by the source within the freshness window → ACTIVE; otherwise UNKNOWN.
 * A failed check never produces CLOSED.
 */
export function computeActivity(r: DerivableRecord, freshnessMs: number, now = new Date()): ActivityStatus {
  if (r.sourceState === "REMOVED_AT_SOURCE" || r.sourceSaysClosed) return "CLOSED";
  if (r.deadline && r.deadline.getTime() < now.getTime()) return "EXPIRED";
  if (r.lastSeenAt && now.getTime() - r.lastSeenAt.getTime() <= freshnessMs) return "ACTIVE";
  return "UNKNOWN";
}

export function isOfficialVerified(r: DerivableRecord): boolean {
  if (!OFFICIAL_SOURCE_CLASSES.includes(r.sourceClass)) return false;
  const s = r.sourceVerification?.status;
  return s === "AUTHORITATIVE_SOURCE" || s === "LINKED_FROM_OFFICIAL_DOMAIN" || s === "ON_OFFICIAL_DOMAIN";
}

export const CHECK_FAILURE_REVIEW_THRESHOLD = 3;

/** Poster names that indicate a recruitment / staffing intermediary (all covered languages). */
const AGENCY_NAME_RE =
  /\b(rekryter\w*|rekrutter\w*|rekrytering|rekruttering|bemanning\w*|vikarbyr\w*|staffing|recruit\w*|personalvermittlung|personaldienstleist\w*|zeitarbeit|intérim|interim|travail temporaire|henkilöstöpalvelu\w*|rekrytointi\w*|headhunt\w*|executive search|talent acquisition)\b/i;

export function looksLikeAgency(name: string | null | undefined) {
  return !!name && AGENCY_NAME_RE.test(name);
}

export function reviewReasons(r: DerivableRecord, activity: ActivityStatus): string[] {
  const reasons: string[] = [];
  if (r.sourceClass === "THIRD_PARTY_AGGREGATOR") reasons.push("Third-party aggregator — the original employer posting has not been established.");
  if (r.sourceClass === "UNVERIFIED_SOURCE") reasons.push("Publisher could not be established.");
  if (r.sourceVerification?.status === "LINK_NOT_FOUND") reasons.push("ATS board is not linked from the employer's official website.");
  if (!r.organization?.name) reasons.push("The source does not name the employer / buyer.");
  if (r.type === "HIRING" && looksLikeAgency(r.organization?.name)) reasons.push("The poster's name indicates a recruitment / staffing agency — the hiring company may be a different organization.");
  if ((r.consecutiveCheckFailures ?? 0) >= CHECK_FAILURE_REVIEW_THRESHOLD) reasons.push(`Source unreachable on the last ${r.consecutiveCheckFailures} status checks — activity could not be verified.`);
  if (activity === "UNKNOWN" && r.sourceState === "LISTED" && (r.consecutiveCheckFailures ?? 0) > 0) reasons.push("Activity could not be confirmed on the last check.");
  return reasons;
}

export function deriveLabels(r: DerivableRecord, activity: ActivityStatus, reasons: string[]): VerificationLabel[] {
  const labels: VerificationLabel[] = [];
  const manual = r.manualVerification?.result;
  if (isOfficialVerified(r) && manual !== "NOT_GENUINE") labels.push("VERIFIED_OFFICIAL_SOURCE");
  if (r.employerIdentity === "CONFIRMED") labels.push("EMPLOYER_IDENTITY_CONFIRMED");
  if (activity === "ACTIVE") labels.push("ACTIVE_STATUS_CHECKED");
  if (r.sourceState === "REMOVED_AT_SOURCE") labels.push("REMOVED_AT_SOURCE");
  if (activity === "CLOSED" || activity === "EXPIRED") labels.push("CLOSED_OR_EXPIRED");
  const reviewed = manual === "CONFIRMED_GENUINE" || manual === "NOT_GENUINE";
  if (reasons.length && !reviewed && activity !== "CLOSED" && activity !== "EXPIRED") labels.push("NEEDS_MANUAL_REVIEW");
  if (manual === "NOT_GENUINE" || (!isOfficialVerified(r) && manual !== "CONFIRMED_GENUINE")) labels.push("UNVERIFIED");
  return labels;
}

/** Hosts of ATS / application systems that employers use as their own application route. */
const EMPLOYER_APPLICATION_HOSTS = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|teamtailor\.com|jobylon\.com|varbi\.com|webcruiter\.(no|com)|recman\.no|reachmee\.com|workday(jobs)?\.com|myworkdayjobs\.com|smartrecruiters\.com|successfactors\.(com|eu)|personio\.(de|com)|recruitee\.com|workable\.com|emply\.com|hr-manager\.net|talentech\.com|jobteaser\.com)$/i;

export type RouteInput = {
  type: "HIRING" | "PROCUREMENT";
  sourceClass: SourceClass;
  applyUrl?: string | null;
  thirdPartyUrl?: string | null;
  orgDomain?: string | null;
  contacts: { kind: string; email?: string | null; url?: string | null; thirdParty?: boolean | null }[];
};

/** Contact / action routes — each derived from a published link or contact. */
export function deriveContactRoutes(r: RouteInput): ContactRoute[] {
  const routes = new Set<ContactRoute>();
  const linkRoute = (url: string): ContactRoute => {
    if (r.type === "PROCUREMENT") return "PROCUREMENT_SUBMISSION";
    const host = hostOf(url);
    const sameOrg = !!r.orgDomain && registrableDomain(host) === r.orgDomain;
    const employerHosted = r.sourceClass === "OFFICIAL_EMPLOYER_SOURCE" || r.sourceClass === "OFFICIAL_EMPLOYER_ATS" || sameOrg || (!!host && EMPLOYER_APPLICATION_HOSTS.test(host));
    return employerHosted ? "DIRECT_APPLICATION" : "THIRD_PARTY_ROUTE";
  };
  if (r.applyUrl) routes.add(linkRoute(r.applyUrl));
  if (r.thirdPartyUrl) routes.add("THIRD_PARTY_ROUTE");
  for (const c of r.contacts) {
    if (c.thirdParty) {
      routes.add("THIRD_PARTY_ROUTE");
      continue;
    }
    if (c.kind === "NAMED_PERSON") routes.add("NAMED_CONTACT_ON_NOTICE");
    else if (c.kind === "SUBMISSION_LINK") routes.add("PROCUREMENT_SUBMISSION");
    else if (c.kind === "APPLICATION_LINK") {
      if (!r.applyUrl && c.url) routes.add(linkRoute(c.url));
    }
    else if (c.kind === "APPLICATION_EMAIL") routes.add("DIRECT_APPLICATION");
    else if (c.kind === "ORGANIZATION_EMAIL" || c.kind === "ORGANIZATION_PHONE" || c.kind === "ORGANIZATION_WEBSITE") {
      if (r.sourceClass !== "THIRD_PARTY_AGGREGATOR") routes.add("OFFICIAL_COMPANY_CHANNEL");
    }
  }
  if (!routes.size) routes.add("NONE");
  return [...routes];
}

/** Organization domain from its published website (ignoring generic / platform hosts). */
export function orgDomainOf(website?: string | null, emails: (string | null | undefined)[] = []): string | undefined {
  const host = hostOf(website);
  if (host && !isGenericHost(host)) return registrableDomain(host);
  for (const e of emails) {
    const d = emailDomain(e);
    if (d && !isGenericHost(d)) return registrableDomain(d);
  }
  return undefined;
}
