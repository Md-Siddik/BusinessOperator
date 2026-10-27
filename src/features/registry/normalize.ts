import "server-only";
import crypto from "node:crypto";
import { classifyIndustry } from "@/config/industries";
import { countryName } from "@/config/countries";
import { contactQuality, type ContactSourceKind } from "@/lib/company-fields";
import { classifyCompany, companyTypeSet } from "@/lib/company-classification";
import { dayToDate } from "@/lib/dates/country-time";
import { formatAddress } from "./normalize-helpers";
import type { CompanyRegistryProvider, NormalizedCompany, NormalizedPerson } from "./types";

type SourceMeta = { kind?: ContactSourceKind | string | null; source?: string | null; url?: string | null; at?: Date | null; verified?: boolean | null };
type PersonLike = { name?: string | null; role?: string | null; roleCode?: string | null; group?: string | null };

/** The subset of an existing company the merge needs. */
export type ExistingCompany = {
  _id: unknown;
  sourceHash?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  website?: string | null;
  address?: string | null;
  contactPerson?: PersonLike | null;
  contactSources?: Partial<Record<"email" | "phone" | "mobile" | "website" | "contactPerson", SourceMeta | null>> | null;
  eligibility?: { status?: string | null } | null;
  companyType?: { manual?: boolean | null } | null;
};

const CONTACT_KEYS = ["email", "phone", "mobile", "website"] as const;

/** Stable hash of the normalized record (without raw payload) to detect unchanged records. */
export function hashNormalized(n: NormalizedCompany) {
  const { source, ...rest } = n;
  return crypto.createHash("sha1").update(JSON.stringify({ ...rest, sourceUrl: source.url })).digest("hex");
}

/** Decide one contact value: registry values win only over empty or registry-sourced values. */
function mergeContact(existingValue: string | null | undefined, existingMeta: SourceMeta | null | undefined, registryValue: string | undefined) {
  const existingKind = existingMeta?.kind;
  if (registryValue) {
    if (!existingValue || !existingKind || existingKind === "REGISTRY") return { value: registryValue, fromRegistry: true };
    return { value: existingValue, fromRegistry: false }; // keep website/enrichment/manual value; registry copy goes to Contact provenance
  }
  // Registry no longer has a value: drop it only if it came from the registry.
  if (existingKind === "REGISTRY" || (!existingKind && existingValue)) return { value: undefined, fromRegistry: true };
  return { value: existingValue ?? undefined, fromRegistry: false };
}

export function personOrUndefined(p: NormalizedPerson | undefined) {
  return p?.name ? { name: p.name, role: p.role, roleCode: p.roleCode, group: p.group } : undefined;
}

/**
 * Build the $set / $unset for one company from a provider record, merging
 * with existing contact data according to source authority.
 */
export function buildCompanyUpdate(n: NormalizedCompany, provider: CompanyRegistryProvider, countryCode: string, existing: ExistingCompany | undefined, now: Date) {
  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  const put = (key: string, value: unknown) => {
    if (value === undefined || value === null || value === "") unset[key] = 1;
    else set[key] = value;
  };

  const business = n.address.business;
  const addressLine = business?.street;
  put("companyName", n.identity.name);
  put("registrationNumber", n.identity.registrationNumber);
  set.countryName = countryName(countryCode);
  put("registrationDay", n.registration.registrationDay);
  put("registrationDate", n.registration.registrationDay ? dayToDate(n.registration.registrationDay) : undefined);
  put("incorporationDate", n.registration.incorporationDay ? dayToDate(n.registration.incorporationDay) : undefined);
  put("status", n.registration.status);
  put("legalForm", n.registration.legalForm);
  put("legalFormCode", n.registration.legalFormCode);
  put("industryCode", n.classification.industryCode);
  put("industryDescription", n.classification.industryDescription);
  put("industryCodeSystem", n.classification.codeSystem);
  put("naceCode", n.classification.naceCode);
  set.industry = classifyIndustry(n.classification.naceCode ?? n.classification.industryCode);
  put("businessActivity", n.classification.businessActivity);
  put("companyPurpose", n.classification.purpose);
  put("address", addressLine);
  put("postalCode", business?.postalCode);
  put("city", business?.city);
  put("region", business?.region);
  put("postalAddress", formatAddress(n.address.postal));
  put("employees", n.employees);
  set.marketingProtected = n.marketingProtected === true;
  if (n.marketingProtected && existing?.eligibility?.status !== "DO_NOT_CONTACT") {
    // A source-level marketing restriction always wins over an earlier review clearance.
    set["eligibility.status"] = "RESTRICTED";
    set["eligibility.reason"] = n.marketingRestrictionReason ?? `Marketing restriction published by ${provider.sourceName}`;
    set["eligibility.at"] = now;
  }
  set.eventType = n.eventType ?? "NEW_ENTITY";
  put("registrationDateType", provider.registrationDateType);
  put("sourcePublishedAt", n.source.publishedAt);
  // Company Type (shared classification) — a manual decision is never overwritten.
  if (!existing?.companyType?.manual) {
    set.companyType = companyTypeSet(
      classifyCompany(
        { incorporationDate: n.registration.incorporationDay, registrationDay: n.registration.registrationDay, eventType: set.eventType as string, status: n.registration.status, employees: n.employees },
        now,
      ),
      now,
    );
  }

  // Contacts with provenance
  const merged: Record<string, string | undefined> = {};
  for (const key of CONTACT_KEYS) {
    const m = mergeContact(existing?.[key], existing?.contactSources?.[key], n.contact[key]);
    merged[key] = m.value;
    put(key, m.value);
    if (m.fromRegistry) {
      if (m.value) set[`contactSources.${key}`] = { kind: "REGISTRY", source: provider.sourceName, url: n.source.url, at: now };
      else unset[`contactSources.${key}`] = 1;
    }
  }

  // People from the registry record itself (some providers include them inline).
  if (n.people?.length) set.people = n.people;
  let contactPerson = existing?.contactPerson ?? undefined;
  const cp = personOrUndefined(n.contactPerson);
  if (cp && (!existing?.contactPerson?.name || existing?.contactSources?.contactPerson?.kind === "REGISTRY")) {
    contactPerson = cp;
    set.contactPerson = cp;
    set["contactSources.contactPerson"] = { kind: "REGISTRY", source: provider.sourceName, url: n.source.url, at: now };
  }

  const q = contactQuality({ ...merged, address: addressLine ?? business?.city, contactPerson });
  set.contactFlags = q.flags;
  set.completeness = q.completeness;
  set.fullyContactable = q.fullyContactable;

  // Source & freshness
  set.sourceName = provider.sourceName;
  set.sourceType = provider.sourceType;
  set.dataFreshness = provider.freshness;
  set.sourceFetchedAt = now;
  put("sourceUrl", n.source.url);
  put("sourceUpdatedAt", n.source.updatedAt);
  if (n.source.raw !== undefined) set.sourceData = n.source.raw;
  set.sourceHash = hashNormalized(n);
  set.isDemo = provider.isDemo;

  // Never unset a key we also set.
  for (const k of Object.keys(set)) delete unset[k];
  return { set, unset, unchanged: !!existing && existing.sourceHash === set.sourceHash };
}

/** Registry contact values to record in the Contact provenance collection. */
export function registryContacts(n: NormalizedCompany) {
  const out: { type: "EMAIL" | "PHONE" | "MOBILE" | "WEBSITE" | "CONTACT_PERSON"; value: string; role?: string }[] = [];
  if (n.contact.email) out.push({ type: "EMAIL", value: n.contact.email });
  if (n.contact.phone) out.push({ type: "PHONE", value: n.contact.phone });
  if (n.contact.mobile) out.push({ type: "MOBILE", value: n.contact.mobile });
  if (n.contact.website) out.push({ type: "WEBSITE", value: n.contact.website });
  if (n.contactPerson?.name) out.push({ type: "CONTACT_PERSON", value: n.contactPerson.name, role: n.contactPerson.role });
  return out;
}
