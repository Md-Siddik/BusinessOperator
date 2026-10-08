import "server-only";
import { Company, type CompanyDoc } from "@/models";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { can, type Actor } from "@/lib/permissions";
import { parseObjectId } from "@/lib/validation";
import { researchCompany } from "@/features/research/engine";

/**
 * "Find contact details" on the company profile — runs the same bounded,
 * source-attributed research sequence as the background worker, immediately.
 * See src/features/research/engine.ts.
 */
export async function runEnrichment(actor: Actor, companyId: string) {
  if (!can(actor, "companies.edit") && !can(actor, "leads.manage")) throw Errors.forbidden();
  const company = await Company.findById(parseObjectId(companyId)).select("_id countryCode isDemo").lean<CompanyDoc>();
  if (!company) throw Errors.notFound();
  if (company.isDemo) throw Errors.badRequest("Demo companies use fictional .example domains — contact research is not available for demo data.");
  const result = await researchCompany(company._id, { reason: "manual", manual: true });
  await audit(actor, "company.researched", { entityType: "Company", entityId: companyId, countryCode: company.countryCode, metadata: { status: result?.status, costCents: result?.costCents } });
  return { steps: result?.steps ?? [], status: result?.status, nextRetryAt: result?.nextRetryAt ?? null, filled: [] as string[] };
}
