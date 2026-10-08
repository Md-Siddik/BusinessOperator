import crypto from "node:crypto";
import { profileForIndustry } from "@/config/industries";
import { Company, WebsiteAudit, type CompanyDoc, type WebsiteAuditDoc } from "@/models";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { can, type Actor } from "@/lib/permissions";
import { parseObjectId } from "@/lib/validation";
import { connectToDatabase, isDatabaseConfigured } from "@/lib/db/connect";

/**
 * Prospect pages (/explore/[token]): a personalised, unguessable page per
 * company built only from facts we hold. Disabled by default; staff enable it.
 */
export async function setProspectPage(actor: Actor, companyId: string, enabled: boolean) {
  if (!can(actor, "companies.edit") && !can(actor, "outreach.manage")) throw Errors.forbidden();
  const company = await Company.findById(parseObjectId(companyId)).lean<CompanyDoc>();
  if (!company) throw Errors.notFound();
  const token = company.prospectPage?.token || crypto.randomBytes(12).toString("base64url");
  await Company.updateOne({ _id: company._id }, { $set: { prospectPage: { token, enabled, createdAt: company.prospectPage?.createdAt ?? new Date() } } });
  await audit(actor, enabled ? "prospect_page.enabled" : "prospect_page.disabled", { entityType: "Company", entityId: companyId, countryCode: company.countryCode });
  return { token, enabled };
}

export type ProspectView = {
  companyName: string;
  website?: string | null;
  observations: { key: string; vars?: Record<string, string> }[];
  serviceItems: string[];
};

export async function getProspectView(token: string): Promise<ProspectView | null> {
  if (!isDatabaseConfigured() || !/^[A-Za-z0-9_-]{10,40}$/.test(token)) return null;
  await connectToDatabase();
  const company = await Company.findOne({ "prospectPage.token": token, "prospectPage.enabled": true }).lean<CompanyDoc>();
  if (!company) return null;
  const latest = await WebsiteAudit.findOne({ companyId: company._id }).sort({ checkedAt: -1 }).lean<WebsiteAuditDoc>();
  const observations: ProspectView["observations"] = [];
  if (!company.website) observations.push({ key: "noWebsite" });
  else {
    observations.push({ key: "hasWebsite", vars: { website: company.website.replace(/^https?:\/\//, "") } });
    if (latest?.ok) {
      if (latest.https === false) observations.push({ key: "noHttps" });
      if (!latest.metaDescription) observations.push({ key: "noMeta" });
      if (latest.mobileFriendly === false) observations.push({ key: "notMobile" });
    }
  }
  if (company.registrationDate && Date.now() - new Date(company.registrationDate).getTime() < 120 * 86_400_000) observations.push({ key: "newlyRegistered" });
  if (company.signals?.hiring) observations.push({ key: "hiring" });
  const profile = profileForIndustry(company.industry ?? undefined, company.signals?.hiring ?? false);
  return { companyName: company.companyName, website: company.website, observations, serviceItems: [...profile.items] };
}
