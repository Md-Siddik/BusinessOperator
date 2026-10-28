import "server-only";
import type { PipelineStage } from "mongoose";
import { z } from "zod";
import { COUNTRY_CODES } from "@/config/countries";
import { Company, EstablishedCompany, type EstablishedCompanyDoc } from "@/models";
import { audit } from "@/lib/audit";
import { classifyCompany, isInactiveStatus } from "@/lib/company-classification";
import { dayToDate } from "@/lib/dates/country-time";
import { Errors } from "@/lib/errors";
import { can, isInternal, type Actor } from "@/lib/permissions";
import { escapeRegex } from "@/lib/utils";
import { paginate } from "@/lib/validation";
import { csvCell } from "@/features/companies/registrations";
import type { CompanyRegistryProvider, NormalizedCompany } from "@/features/registry/types";
import { foundedCutoff, getEstablishedConfig } from "./config";
import { identityKeys, nameKeyOf, normalizeRegistrationNumber } from "./identity";

/**
 * Old company Intelligence data layer. Reads and writes ONLY the EstablishedCompany collection;
 * the Company collection (Startup Company Intelligence) is only ever read, to keep the two
 * datasets disjoint:
 *
 *  1. Write time — a record matching a startup record (same country + registration number,
 *     registry id or exact name) is refused before insert.
 *  2. Database — identityKeys is uniquely indexed, so one registered company is stored once.
 *  3. Sweep — sweepStartupOverlap() removes Old records whose normalized name or registration
 *     number later appears in the startup register (startup always wins; startup is untouched).
 *  4. Read time — every list / export / count drops rows whose registration number exists in
 *     the startup register, so an overlap can't be shown even between sweeps.
 *
 * There is no fallback: no data → an empty list, never startup records.
 */

/* ───────────────────────── Qualification ───────────────────────── */

export type Qualification = { ok: true; foundedOn: Date; reason: string; basis: string[] } | { ok: false; reason: string };

/**
 * Whether a registry record qualifies as an established business. The date alone never does:
 * the registry must publish a registration number, a founding / registration date at least
 * `minAgeYears` old, an active status, and the record must not be a branch or a startup by the
 * shared classification (e.g. a young re-registration).
 */
export function qualifyEstablished(n: NormalizedCompany, minAgeYears: number, now = new Date()): Qualification {
  if (!normalizeRegistrationNumber(n.identity.registrationNumber)) return { ok: false, reason: "No official registration number" };
  const status = n.registration.status?.trim();
  if (!status) return { ok: false, reason: "No registry status published" };
  if (isInactiveStatus(status)) return { ok: false, reason: `Not operating (${status})` };
  const day = n.registration.incorporationDay ?? n.registration.registrationDay;
  if (!day) return { ok: false, reason: "No founding or registration date" };
  const foundedOn = dayToDate(day);
  if (Number.isNaN(foundedOn.getTime()) || foundedOn > foundedCutoff(minAgeYears, now)) return { ok: false, reason: `Registered less than ${minAgeYears} years ago` };
  if ((n.eventType ?? "NEW_ENTITY").toUpperCase() === "BRANCH") return { ok: false, reason: "Branch of another company" };
  const c = classifyCompany({ incorporationDate: n.registration.incorporationDay, registrationDay: n.registration.registrationDay, eventType: n.eventType ?? "NEW_ENTITY", status, employees: n.employees }, now);
  if (c.value === "STARTUP") return { ok: false, reason: c.reason };
  return { ok: true, foundedOn, reason: c.value === "ESTABLISHED" ? c.reason : `Registered ${day} and listed as “${status}” by the registry.`, basis: c.basis };
}

/* ───────────────────────── Cross-module duplicate check ───────────────────────── */

/**
 * Which candidates already exist in Startup Company Intelligence (by registry id, registration
 * number or name — case and accent insensitive here; punctuation / legal-form variants are
 * caught by the normalized comparison in sweepStartupOverlap).
 */
export async function startupMatches(code: string, candidates: { source: string; sourceId: string; registrationNumber?: string; companyName: string }[]) {
  if (!candidates.length) return new Set<number>();
  const regs = [...new Set(candidates.flatMap((c) => (c.registrationNumber ? [c.registrationNumber.trim(), normalizeRegistrationNumber(c.registrationNumber)!] : [])))];
  const rows = await Company.find({
    countryCode: code,
    $or: [
      { registrationNumber: { $in: regs } },
      { sourceId: { $in: candidates.map((c) => c.sourceId) } },
      { companyName: { $in: [...new Set(candidates.map((c) => c.companyName.trim()))] } },
    ],
  })
    .collation({ locale: "en", strength: 1 })
    .select("registrationNumber source sourceId companyName")
    .lean<{ registrationNumber?: string; source: string; sourceId: string; companyName: string }[]>();
  const regKeys = new Set(rows.map((r) => normalizeRegistrationNumber(r.registrationNumber)).filter(Boolean));
  const srcKeys = new Set(rows.map((r) => `${r.source}:${r.sourceId}`));
  const nameKeys = new Set(rows.map((r) => nameKeyOf(code, r.companyName)));
  const collated = new Set(rows.map((r) => r.companyName.trim().normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()));
  const out = new Set<number>();
  candidates.forEach((c, i) => {
    const reg = normalizeRegistrationNumber(c.registrationNumber);
    const plain = c.companyName.trim().normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
    if ((reg && regKeys.has(reg)) || srcKeys.has(`${c.source}:${c.sourceId}`) || nameKeys.has(nameKeyOf(code, c.companyName)) || collated.has(plain)) out.add(i);
  });
  return out;
}

/* ───────────────────────── Storage ───────────────────────── */

export type StoreResult = { received: number; qualified: number; excludedAsStartup: number; imported: number; updated: number; failed: number; rejected: Record<string, number> };

/** Store qualifying registry records in the Old company dataset (never in Company). */
export async function storeEstablished(provider: Pick<CompanyRegistryProvider, "id" | "sourceName">, code: string, records: NormalizedCompany[], opts: { now?: Date; minAgeYears?: number } = {}): Promise<StoreResult> {
  const now = opts.now ?? new Date();
  const minAgeYears = opts.minAgeYears ?? (await getEstablishedConfig()).minAgeYears;
  const out: StoreResult = { received: records.length, qualified: 0, excludedAsStartup: 0, imported: 0, updated: 0, failed: 0, rejected: {} };
  const kept: { n: NormalizedCompany; q: Extract<Qualification, { ok: true }> }[] = [];
  const seen = new Set<string>();
  for (const n of records) {
    if (!n.identity.sourceId || !n.identity.name) continue;
    const q = qualifyEstablished(n, minAgeYears, now);
    if (!q.ok) {
      out.rejected[q.reason] = (out.rejected[q.reason] ?? 0) + 1;
      continue;
    }
    if (seen.has(n.identity.sourceId)) continue;
    seen.add(n.identity.sourceId);
    kept.push({ n, q });
  }
  out.qualified = kept.length;
  const startup = await startupMatches(
    code,
    kept.map(({ n }) => ({ source: provider.id, sourceId: n.identity.sourceId, registrationNumber: n.identity.registrationNumber, companyName: n.identity.name })),
  );
  out.excludedAsStartup = startup.size;
  const ops = kept
    .filter((_, i) => !startup.has(i))
    .map(({ n, q }) => {
      const a = n.address.business ?? n.address.postal;
      const set: Partial<EstablishedCompanyDoc> = {
        sourceName: provider.sourceName,
        sourceUrl: n.source.url,
        companyName: n.identity.name,
        nameKey: nameKeyOf(code, n.identity.name),
        registrationNumber: n.identity.registrationNumber!.trim(),
        identityKeys: identityKeys({ countryCode: code, source: provider.id, sourceId: n.identity.sourceId, registrationNumber: n.identity.registrationNumber, companyName: n.identity.name }),
        incorporationDate: n.registration.incorporationDay ? dayToDate(n.registration.incorporationDay) : undefined,
        registrationDay: n.registration.registrationDay,
        foundedOn: q.foundedOn,
        status: n.registration.status!.trim(),
        legalForm: n.registration.legalForm,
        industryCode: n.classification.industryCode,
        industryDescription: n.classification.industryDescription,
        businessActivity: n.classification.businessActivity,
        address: a ? { street: a.street, postalCode: a.postalCode, city: a.city, region: a.region } : undefined,
        email: n.contact.email,
        phone: n.contact.phone ?? n.contact.mobile,
        website: n.contact.website,
        employees: n.employees,
        verification: { reason: q.reason, basis: q.basis, verifiedAt: now },
        lastSeenAt: now,
      };
      return {
        updateOne: {
          filter: { countryCode: code, source: provider.id, sourceId: n.identity.sourceId },
          update: { $set: set, $setOnInsert: { countryCode: code, source: provider.id, sourceId: n.identity.sourceId, firstSeenAt: now } },
          upsert: true,
        },
      };
    });
  if (!ops.length) return out;
  try {
    const res = await EstablishedCompany.bulkWrite(ops, { ordered: false });
    out.imported = res.upsertedCount;
    out.updated = res.modifiedCount;
  } catch (err) {
    // Unique identity keys: the same registered company under another id is refused, the rest is stored.
    const e = err as { writeErrors?: unknown[]; result?: { upsertedCount?: number; modifiedCount?: number } };
    out.imported = e.result?.upsertedCount ?? 0;
    out.updated = e.result?.modifiedCount ?? 0;
    out.failed = e.writeErrors?.length ?? 1;
  }
  return out;
}

/**
 * Remove Old records that (now) match a startup record by registration number, registry id or
 * normalized name in the same country. Reads Company, deletes only from EstablishedCompany.
 */
export async function sweepStartupOverlap() {
  const old = await EstablishedCompany.find().select("_id countryCode identityKeys nameKey").lean<{ _id: unknown; countryCode: string; identityKeys: string[]; nameKey: string }[]>();
  if (!old.length) return { checked: 0, removed: 0 };
  const byKey = new Map<string, unknown[]>();
  const add = (k: string, id: unknown) => byKey.set(k, [...(byKey.get(k) ?? []), id]);
  for (const o of old) {
    for (const k of o.identityKeys) add(k, o._id);
    add(`name:${o.nameKey}`, o._id);
  }
  const countries = [...new Set(old.map((o) => o.countryCode))];
  const hit = new Set<unknown>();
  const cursor = Company.find({ countryCode: { $in: countries } }).select("countryCode source sourceId registrationNumber companyName").lean().cursor();
  for await (const c of cursor as AsyncIterable<{ countryCode: string; source: string; sourceId: string; registrationNumber?: string; companyName: string }>) {
    const keys = [...identityKeys({ countryCode: c.countryCode, source: c.source, sourceId: c.sourceId, registrationNumber: c.registrationNumber, companyName: c.companyName }), `name:${nameKeyOf(c.countryCode, c.companyName)}`];
    for (const k of keys) for (const id of byKey.get(k) ?? []) hit.add(id);
  }
  if (!hit.size) return { checked: old.length, removed: 0 };
  const res = await EstablishedCompany.deleteMany({ _id: { $in: [...hit] } });
  return { checked: old.length, removed: res.deletedCount ?? 0 };
}

/* ───────────────────────── Reading ───────────────────────── */

export const OLD_COMPANY_SORTS = ["oldest", "newest", "name"] as const;

export const oldCompanyQuerySchema = z.object({
  country: z
    .string()
    .trim()
    .toUpperCase()
    .default("ALL")
    .refine((v) => v === "ALL" || COUNTRY_CODES.includes(v), "Unknown country"),
  q: z.string().trim().max(120).optional(),
  /** Optional stricter age than the configured threshold (never looser). */
  minAge: z.coerce.number().int().min(1).max(200).optional(),
  sort: z.enum(OLD_COMPANY_SORTS).default("oldest"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});
export type OldCompanyQuery = z.infer<typeof oldCompanyQuerySchema>;

function assertCanRead(actor: Actor) {
  if (!isInternal(actor) || !can(actor, "companies.read")) throw Errors.forbidden();
}

/** Filter + startup guard shared by list, export and counts. */
async function basePipeline(q: Pick<OldCompanyQuery, "country" | "q" | "minAge">, now = new Date()) {
  const cfg = await getEstablishedConfig();
  const minAge = Math.max(cfg.minAgeYears, q.minAge ?? 0);
  const match: Record<string, unknown> = { foundedOn: { $lte: foundedCutoff(minAge, now) } };
  if (q.country !== "ALL") match.countryCode = q.country;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    match.$or = [{ companyName: rx }, { registrationNumber: rx }, { "address.city": rx }];
  }
  const pipeline: PipelineStage[] = [
    { $match: match },
    // Read-time guard: never show a company the startup register also holds.
    { $lookup: { from: Company.collection.name, let: { cc: "$countryCode", reg: "$registrationNumber" }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$countryCode", "$$cc"] }, { $eq: ["$registrationNumber", "$$reg"] }] } } }, { $limit: 1 }, { $project: { _id: 1 } }], as: "_startup" } },
    { $match: { _startup: { $size: 0 } } },
    { $project: { _startup: 0, identityKeys: 0, nameKey: 0 } },
  ];
  return { pipeline, minAge, config: cfg };
}

const SORTS: Record<(typeof OLD_COMPANY_SORTS)[number], Record<string, 1 | -1>> = {
  oldest: { foundedOn: 1, _id: 1 },
  newest: { foundedOn: -1, _id: 1 },
  name: { companyName: 1, _id: 1 },
};

export type OldCompanyRow = {
  id: string;
  companyName: string;
  registrationNumber: string;
  countryCode: string;
  foundedOn: string;
  ageYears: number;
  status: string;
  legalForm?: string;
  industry?: string;
  city?: string;
  website?: string;
  email?: string;
  phone?: string;
  employees?: number;
  sourceName?: string;
  sourceUrl?: string;
  verifiedAt?: string;
  reason?: string;
};

const ageYears = (d: Date, now: Date) => Math.floor((now.getTime() - d.getTime()) / (365.25 * 86_400_000));

function toRow(d: EstablishedCompanyDoc, now: Date): OldCompanyRow {
  return {
    id: String(d._id),
    companyName: d.companyName,
    registrationNumber: d.registrationNumber,
    countryCode: d.countryCode,
    foundedOn: d.foundedOn.toISOString().slice(0, 10),
    ageYears: ageYears(d.foundedOn, now),
    status: d.status,
    legalForm: d.legalForm ?? undefined,
    industry: d.industryDescription ?? d.industryCode ?? undefined,
    city: d.address?.city ?? undefined,
    website: d.website ?? undefined,
    email: d.email ?? undefined,
    phone: d.phone ?? undefined,
    employees: d.employees ?? undefined,
    sourceName: d.sourceName ?? undefined,
    sourceUrl: d.sourceUrl ?? undefined,
    verifiedAt: d.verification?.verifiedAt ? new Date(d.verification.verifiedAt).toISOString() : undefined,
    reason: d.verification?.reason ?? undefined,
  };
}

export async function listOldCompanies(actor: Actor, input: unknown, now = new Date()) {
  assertCanRead(actor);
  const q = oldCompanyQuerySchema.parse(input);
  const { pipeline, minAge, config } = await basePipeline(q, now);
  const [res] = await EstablishedCompany.aggregate<{ items: EstablishedCompanyDoc[]; total: { n: number }[]; countries: { _id: string; n: number }[] }>([
    ...pipeline,
    { $facet: { items: [{ $sort: SORTS[q.sort] }, { $skip: (q.page - 1) * q.pageSize }, { $limit: q.pageSize }], total: [{ $count: "n" }], countries: [{ $group: { _id: "$countryCode", n: { $sum: 1 } } }] } },
  ]);
  return {
    ...paginate((res?.items ?? []).map((d) => toRow(d, now)), res?.total[0]?.n ?? 0, q.page, q.pageSize),
    query: q,
    minAgeYears: minAge,
    config,
    byCountry: Object.fromEntries((res?.countries ?? []).map((c) => [c._id, c.n])) as Record<string, number>,
  };
}

const EXPORT_MAX = 5000;

export async function exportOldCompanies(actor: Actor, input: unknown, now = new Date()) {
  assertCanRead(actor);
  if (!can(actor, "companies.export")) throw Errors.forbidden();
  const q = oldCompanyQuerySchema.parse(input);
  const { pipeline, minAge } = await basePipeline(q, now);
  const docs = await EstablishedCompany.aggregate<EstablishedCompanyDoc>([...pipeline, { $sort: SORTS[q.sort] }, { $limit: EXPORT_MAX + 1 }]);
  const truncated = docs.length > EXPORT_MAX;
  const rows = docs.slice(0, EXPORT_MAX).map((d) => toRow(d, now));
  const header = ["Company", "Registration number", "Country", "Founded / registered", "Age (years)", "Registry status", "Legal form", "Industry", "City", "Website", "Email", "Phone", "Employees", "Source", "Source URL", "Verified at"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) lines.push([r.companyName, r.registrationNumber, r.countryCode, r.foundedOn, r.ageYears, r.status, r.legalForm, r.industry, r.city, r.website, r.email, r.phone, r.employees, r.sourceName, r.sourceUrl, r.verifiedAt].map(csvCell).join(","));
  await audit(actor, "established.exported", { entityType: "EstablishedCompany", metadata: { country: q.country, q: q.q, minAge, rows: rows.length, truncated } });
  return { csv: `﻿${lines.join("\r\n")}`, rows: rows.length, truncated };
}

/** Records per module and the cross-module duplicate count (for the isolation report and tests). */
export async function isolationReport() {
  const [startup, old, overlapByReg] = await Promise.all([
    Company.countDocuments({ isDemo: { $ne: true } }),
    EstablishedCompany.countDocuments(),
    EstablishedCompany.aggregate<{ n: number }>([
      { $lookup: { from: Company.collection.name, let: { cc: "$countryCode", reg: "$registrationNumber" }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$countryCode", "$$cc"] }, { $eq: ["$registrationNumber", "$$reg"] }] } } }, { $limit: 1 }], as: "s" } },
      { $match: { "s.0": { $exists: true } } },
      { $count: "n" },
    ]),
  ]);
  const startupFromEstablishedJob = await Company.countDocuments({ discoveredVia: "ESTABLISHED_COLLECTION" });
  return { startup, old, overlap: overlapByReg[0]?.n ?? 0, startupFromEstablishedJob };
}
