import "server-only";
import type { Types } from "mongoose";
import { Company } from "@/models";
import { isGenericHost, normalizeRegNumber } from "./normalize";

/**
 * Link an opportunity's organization to an existing Company Intelligence record —
 * only on reliable evidence:
 *   1. registration number + country (exact)
 *   2. official website domain (exact host, unique match, non-generic host)
 *   3. owner-linked company on an employer feed
 * Never by name similarity: two businesses are never merged because their names look alike.
 */
export type CompanyLink = { companyId: Types.ObjectId; method: "REGISTRATION_NUMBER" | "OFFICIAL_DOMAIN" | "OWNER_LINKED" };

function regVariants(raw: string): string[] {
  const n = normalizeRegNumber(raw)!;
  const out = new Set([raw.trim(), n]);
  // Swedish organisationsnummer is often written NNNNNN-NNNN.
  if (/^\d{10}$/.test(n)) out.add(`${n.slice(0, 6)}-${n.slice(6)}`);
  // Norwegian orgnr sometimes printed with spaces: NNN NNN NNN.
  if (/^\d{9}$/.test(n)) out.add(`${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`);
  return [...out];
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function findCompanyLink(org: { registrationNumber?: string | null; registrationCountry?: string | null; domain?: string | null }, ownerLinkedCompanyId?: string | null): Promise<CompanyLink | null> {
  if (org.registrationNumber && org.registrationCountry) {
    const hits = await Company.find({ countryCode: org.registrationCountry.toUpperCase(), registrationNumber: { $in: regVariants(org.registrationNumber) }, isDemo: { $ne: true } })
      .select("_id")
      .limit(2)
      .lean<{ _id: Types.ObjectId }[]>();
    if (hits.length === 1) return { companyId: hits[0]!._id, method: "REGISTRATION_NUMBER" };
  }
  if (ownerLinkedCompanyId) {
    const c = await Company.findById(ownerLinkedCompanyId).select("_id").lean<{ _id: Types.ObjectId }>();
    if (c) return { companyId: c._id, method: "OWNER_LINKED" };
  }
  if (org.domain && !isGenericHost(org.domain)) {
    const re = new RegExp(`^(https?://)?(www\\.)?${escapeRe(org.domain)}(/|$)`, "i");
    const hits = await Company.find({ website: re, isDemo: { $ne: true } }).select("_id").limit(2).lean<{ _id: Types.ObjectId }[]>();
    // Ambiguous domain (shared by several records) → no link.
    if (hits.length === 1) return { companyId: hits[0]!._id, method: "OFFICIAL_DOMAIN" };
  }
  return null;
}
