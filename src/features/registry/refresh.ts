import "server-only";
import { Company, type CompanyDoc } from "@/models";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { can, type Actor } from "@/lib/permissions";
import { parseObjectId } from "@/lib/validation";
import { rescoreCompanies } from "@/features/companies/service";
import { getRegistryProvider } from "./providers";
import { buildCompanyUpdate, type ExistingCompany } from "./normalize";
import { applyPeople } from "./sync";

type CompanyForRefresh = CompanyDoc & ExistingCompany;

/** Re-fetch one company (and its roles) from its registry — the profile's "Refresh from registry". */
export async function refreshCompanyFromRegistry(actor: Actor, id: string) {
  if (!can(actor, "companies.read")) throw Errors.forbidden();
  const company = await Company.findById(parseObjectId(id)).select("+sourceHash").lean<CompanyForRefresh>();
  if (!company) throw Errors.notFound();
  const provider = getRegistryProvider(company.source);
  if (!provider || provider.isDemo) throw Errors.badRequest("This company's source cannot be refreshed.");
  if (!provider.getCompany || !company.registrationNumber) throw Errors.badRequest(`${provider.sourceName} does not support single-company lookups.`);
  let fresh;
  try {
    fresh = await provider.getCompany(company.registrationNumber, { signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw Errors.badRequest(`${provider.sourceName} is unavailable right now: ${e instanceof Error ? e.message : "request failed"}`);
  }
  if (!fresh) throw Errors.notFound(`${provider.sourceName} no longer lists this company.`);
  const { set, unset } = buildCompanyUpdate(fresh, provider, company.countryCode, company, new Date());
  await Company.updateOne({ _id: company._id }, { $set: set, ...(Object.keys(unset).length && { $unset: unset }) });
  if (provider.getPeople) {
    try {
      const { people, contactPerson } = await provider.getPeople(company.registrationNumber, { signal: AbortSignal.timeout(15_000) });
      const updated = (await Company.findById(company._id).lean<CompanyForRefresh>())!;
      await applyPeople(updated, people, contactPerson, provider);
    } catch {
      /* roles are optional; the company data itself was refreshed */
    }
  }
  await rescoreCompanies({ _id: company._id });
  await audit(actor, "company.refreshed", { entityType: "Company", entityId: id, countryCode: company.countryCode, metadata: { provider: provider.id } });
  return { ok: true, fetchedAt: new Date() };
}

/**
 * Load people/roles on first view of a profile when the sync didn't (older
 * registrations). Best-effort with a short timeout; never blocks the page on failure.
 */
export async function ensurePeople(company: Pick<CompanyDoc, "_id" | "source" | "registrationNumber" | "peopleFetchedAt" | "isDemo">) {
  if (company.peopleFetchedAt || company.isDemo || !company.registrationNumber) return false;
  const provider = getRegistryProvider(company.source);
  if (!provider?.getPeople || !provider.capabilities.supportsRoles || !provider.isConfigured()) return false;
  try {
    const { people, contactPerson } = await provider.getPeople(company.registrationNumber, { signal: AbortSignal.timeout(6_000) });
    const full = await Company.findById(company._id).lean<CompanyForRefresh>();
    if (full) await applyPeople(full, people, contactPerson, provider);
    return true;
  } catch {
    return false;
  }
}
