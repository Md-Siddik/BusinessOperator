import "server-only";
import type { AnyBulkWriteOperation, FilterQuery } from "mongoose";
import { Types } from "mongoose";
import { z } from "zod";
import { Company, type CompanyDoc } from "@/models";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { can, type Actor } from "@/lib/permissions";
import { classifyCompany, COMPANY_TYPE_LABELS, COMPANY_TYPES, companyTypeSet, type CompanyType } from "@/lib/company-classification";
import { parseObjectId } from "@/lib/validation";

/**
 * Server side of the shared Company Type classification (rules: lib/company-classification).
 *  - `reclassifyCompanies` re-evaluates automatic classifications in bulk (migration + daily
 *    scheduler, so a startup ages into "established" without anyone touching it).
 *  - `setCompanyType` records a manual decision (companies.edit), audited; "auto" returns the
 *    company to the automatic rules.
 */

const CLASSIFY_FIELDS = "incorporationDate registrationDate registrationDay eventType status employees companyType";

type ClassifyDoc = Pick<CompanyDoc, "_id" | "incorporationDate" | "registrationDate" | "registrationDay" | "eventType" | "status" | "employees" | "companyType">;

export async function reclassifyCompanies(opts: { filter?: FilterQuery<CompanyDoc>; limit?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const filter: FilterQuery<CompanyDoc> = { "companyType.manual": { $ne: true }, ...(opts.filter ?? {}) };
  let query = Company.find(filter).select(CLASSIFY_FIELDS).sort({ "companyType.at": 1, _id: 1 });
  if (opts.limit) query = query.limit(opts.limit);
  const counts: Record<CompanyType, number> = { STARTUP: 0, ESTABLISHED: 0, NEEDS_REVIEW: 0 };
  let ops: AnyBulkWriteOperation[] = [];
  let changed = 0;
  let total = 0;
  const flush = async () => {
    if (!ops.length) return;
    await Company.bulkWrite(ops, { ordered: false });
    ops = [];
  };
  for await (const c of query.lean<ClassifyDoc[]>().cursor()) {
    const result = classifyCompany(c, now);
    counts[result.value]++;
    total++;
    if (c.companyType?.value !== result.value) changed++;
    // The manual guard is repeated in the filter so a decision saved meanwhile is never overwritten.
    ops.push({ updateOne: { filter: { _id: c._id, "companyType.manual": { $ne: true } }, update: { $set: { companyType: companyTypeSet(result, now) } } } });
    if (ops.length >= 500) await flush();
  }
  await flush();
  return { total, changed, counts };
}

/** Daily: re-evaluate classifications older than a week (bounded batch). */
export async function reclassifyStale(limit = 5000, now = new Date()) {
  const staleBefore = new Date(now.getTime() - 7 * 86_400_000);
  return reclassifyCompanies({ filter: { $or: [{ "companyType.at": { $lt: staleBefore } }, { "companyType.value": { $exists: false } }] }, limit, now });
}

export const companyTypeChangeSchema = z.object({ value: z.enum([...COMPANY_TYPES, "AUTO"]) });

export async function setCompanyType(actor: Actor, id: string, input: unknown) {
  if (!can(actor, "companies.edit")) throw Errors.forbidden();
  const { value } = companyTypeChangeSchema.parse(input);
  const _id = parseObjectId(id);
  const company = await Company.findById(_id).select(`${CLASSIFY_FIELDS} countryCode companyName`).lean<ClassifyDoc & { countryCode: string; companyName: string }>();
  if (!company) throw Errors.notFound("Company not found");
  const now = new Date();
  const before = company.companyType?.value ?? null;
  let next: Record<string, unknown>;
  if (value === "AUTO") {
    next = companyTypeSet(classifyCompany(company, now), now);
  } else {
    next = { value, reason: `Set to “${COMPANY_TYPE_LABELS[value]}” by ${actor.name}.`, basis: ["Manual decision"], at: now, manual: true, by: new Types.ObjectId(actor.id) };
  }
  await Company.updateOne({ _id }, { $set: { companyType: next } });
  await audit(actor, "company.type_changed", { entityType: "Company", entityId: String(_id), countryCode: company.countryCode, metadata: { from: before, to: next.value, manual: value !== "AUTO" } });
  return { value: next.value as CompanyType, reason: next.reason as string, manual: value !== "AUTO" };
}
