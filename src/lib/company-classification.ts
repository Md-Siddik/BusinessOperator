/**
 * Company Type — the ONE shared classification of a company as a Startup, an Established
 * Company or Needs Review. Client-safe and pure: the registry ingest, the migration, the daily
 * re-evaluation, Company Intelligence and the Digital Marketer table all read the value this
 * module computes (stored on Company.companyType). No other module classifies companies.
 *
 * Rules (age is never used alone; anything not clearly supported goes to Needs Review):
 *  - Manual decisions (by someone allowed to edit company records) always win.
 *  - A company the registry marks as not active (dissolved, struck off, in liquidation …) is
 *    not an operating business → Needs Review.
 *  - No founding / registration date → Needs Review (nothing is guessed).
 *  - Branches of another (often foreign) company → Needs Review: the parent decides.
 *  - Re-registrations (conversion, continuation, relocation, name change) of an existing
 *    business → Established once the record is ≥ 5 years old, otherwise Needs Review.
 *  - New entity < 3 years old → Startup, unless it already reports ≥ 50 employees
 *    (likely a subsidiary or spin-off of an established group) → Needs Review.
 *  - New entity ≥ 5 years old and still listed as active → Established (operating history).
 *  - 3–5 years old → Established only with ≥ 10 reported employees, otherwise Needs Review.
 */

export const COMPANY_TYPES = ["STARTUP", "ESTABLISHED", "NEEDS_REVIEW"] as const;
export type CompanyType = (typeof COMPANY_TYPES)[number];

export const COMPANY_TYPE_LABELS: Record<CompanyType, string> = {
  STARTUP: "Startup",
  ESTABLISHED: "Established Company",
  NEEDS_REVIEW: "Needs Review",
};

/** URL / filter values ("startup", "established", "review"). */
export const COMPANY_TYPE_PARAMS = { startup: "STARTUP", established: "ESTABLISHED", review: "NEEDS_REVIEW" } as const satisfies Record<string, CompanyType>;
export type CompanyTypeParam = keyof typeof COMPANY_TYPE_PARAMS;
export const COMPANY_TYPE_PARAM_OF: Record<CompanyType, CompanyTypeParam> = { STARTUP: "startup", ESTABLISHED: "established", NEEDS_REVIEW: "review" };

export function parseCompanyTypeParam(v: unknown): CompanyType | undefined {
  return typeof v === "string" && v in COMPANY_TYPE_PARAMS ? COMPANY_TYPE_PARAMS[v as CompanyTypeParam] : undefined;
}

export const STARTUP_MAX_YEARS = 3;
export const ESTABLISHED_MIN_YEARS = 5;
const LARGE_EMPLOYEES = 50;
const SCALE_EMPLOYEES = 10;

const RE_REGISTRATION = ["CONVERSION", "CONTINUATION", "RELOCATION", "NAME_CHANGE"];

/** Registry statuses that mean the business is no longer operating (several languages). */
export const INACTIVE_STATUS =
  /(dissol|struck|strike[- ]?off|removed|deregist|de-regist|liquidat|likvid|insolv|bankrupt|konkurs|slett|avvikl|tvangsoppl|cancel|ceased|cessation|inactive|in-active|closed|terminated|deleted|wound up|winding up|lakannut|lakkautet|poistettu|selvitystila|zanik|zrušen|radi[ée]|gelöscht|löschung|aufgelöst|ausgeschieden|external administration|deregistered|revoked|forfeited|expired|merged into|absorbed)/i;

export function isInactiveStatus(status: string | null | undefined) {
  return !!status && INACTIVE_STATUS.test(status);
}

export type ClassificationInput = {
  incorporationDate?: Date | string | null;
  registrationDate?: Date | string | null;
  registrationDay?: string | null;
  eventType?: string | null;
  status?: string | null;
  employees?: number | null;
};

export type Classification = {
  value: CompanyType;
  /** Plain-language reason shown next to the tag. */
  reason: string;
  /** The evidence the decision rests on. */
  basis: string[];
  foundedYear?: number;
};

const toDate = (v: Date | string | null | undefined) => {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

/** Founding date: incorporation date when published, otherwise the registry's registration date. */
export function foundingDate(c: ClassificationInput) {
  return toDate(c.incorporationDate) ?? toDate(c.registrationDate) ?? toDate(c.registrationDay ?? undefined);
}

export function classifyCompany(c: ClassificationInput, now = new Date()): Classification {
  const founded = foundingDate(c);
  const event = (c.eventType ?? "NEW_ENTITY").toUpperCase();
  const employees = typeof c.employees === "number" && c.employees >= 0 ? c.employees : undefined;
  const basis: string[] = [];
  if (c.status) basis.push(`Registry status: ${c.status}`);
  if (employees !== undefined) basis.push(`${employees} employee${employees === 1 ? "" : "s"} reported by the registry`);

  if (isInactiveStatus(c.status)) return { value: "NEEDS_REVIEW", reason: `The registry lists this company as “${c.status}” — not an operating business.`, basis };
  if (!founded) return { value: "NEEDS_REVIEW", reason: "No founding or registration date is published, so the stage can't be supported.", basis };

  const years = (now.getTime() - founded.getTime()) / (365.25 * 86_400_000);
  const foundedYear = founded.getUTCFullYear();
  basis.unshift(`Founded / registered ${founded.toISOString().slice(0, 10)}`);
  const ageText = years < 1 ? `${Math.max(0, Math.round(years * 12))} month${Math.round(years * 12) === 1 ? "" : "s"}` : `${Math.floor(years)} year${Math.floor(years) === 1 ? "" : "s"}`;

  if (event === "BRANCH") return { value: "NEEDS_REVIEW", reason: "Registered as a branch of another company — classify by the parent company.", basis: [...basis, "Branch registration"], foundedYear };
  if (RE_REGISTRATION.includes(event)) {
    basis.push(`Re-registration of an existing business (${event.toLowerCase().replace(/_/g, " ")})`);
    if (years >= ESTABLISHED_MIN_YEARS) return { value: "ESTABLISHED", reason: `Existing business on record for ${ageText}.`, basis, foundedYear };
    return { value: "NEEDS_REVIEW", reason: "Re-registration of an existing business — its real founding date isn't published.", basis, foundedYear };
  }
  if (event !== "NEW_ENTITY") return { value: "NEEDS_REVIEW", reason: "The registry event type is ambiguous.", basis, foundedYear };
  basis.push("Registered as a new legal entity");

  if (years < STARTUP_MAX_YEARS) {
    if (employees !== undefined && employees >= LARGE_EMPLOYEES) {
      return { value: "NEEDS_REVIEW", reason: `Registered ${ageText} ago but already reports ${employees} employees — possibly a subsidiary or spin-off of an established group.`, basis, foundedYear };
    }
    return { value: "STARTUP", reason: `New legal entity registered ${ageText} ago${employees !== undefined ? ` with ${employees} employee${employees === 1 ? "" : "s"}` : ""}.`, basis, foundedYear };
  }
  if (years >= ESTABLISHED_MIN_YEARS) {
    return { value: "ESTABLISHED", reason: `Operating since ${foundedYear} (${ageText}) and still listed${c.status ? ` as “${c.status}”` : ""} by the registry.`, basis, foundedYear };
  }
  if (employees !== undefined && employees >= SCALE_EMPLOYEES) {
    return { value: "ESTABLISHED", reason: `Operating since ${foundedYear} with ${employees} employees.`, basis, foundedYear };
  }
  return { value: "NEEDS_REVIEW", reason: `${ageText} old with no further evidence of stage (between startup and established).`, basis, foundedYear };
}

/** Stored shape (Company.companyType) — the single source both sections read. */
export type StoredCompanyType = {
  value?: CompanyType | string | null;
  reason?: string | null;
  manual?: boolean | null;
};

export function companyTypeOf(stored: StoredCompanyType | null | undefined): CompanyType {
  const v = stored?.value;
  return v && (COMPANY_TYPES as readonly string[]).includes(v) ? (v as CompanyType) : "NEEDS_REVIEW";
}

/** $set for Company.companyType from a computed classification (never over a manual decision). */
export function companyTypeSet(c: Classification, now = new Date()) {
  return { value: c.value, reason: c.reason, basis: c.basis, foundedYear: c.foundedYear, at: now, manual: false };
}
