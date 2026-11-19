/** Read-only, dated maintenance candidates. Does not delete, update or build indexes. */
import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { configureMongoDns, hasExplicitMongoDatabase } from "../src/lib/db/configuration";

loadEnvConfig(process.cwd());
const cutoffDay = "2026-11-01";
const cutoffDate = new Date(`${cutoffDay}T00:00:00.000Z`);
async function main() {
  configureMongoDns();
  const uri = process.env.MONGODB_URI;
  if (!uri || !hasExplicitMongoDatabase(uri)) throw new Error("An explicit database URI is required.");
  const previous = JSON.parse(await readFile("storage/backups/storage-audit/cleanup-plan.json", "utf8")) as { database: string; capturedAt: string; candidateCompanyIds: string[] };
  if (Date.now() - Date.parse(previous.capturedAt) > 3_600_000) throw new Error("Refresh storage-cleanup-plan.ts first; reference audit is older than one hour.");
  const client = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 12000, connectTimeoutMS: 8000 });
  try {
    await client.connect();
    const db = client.db();
    if (db.databaseName !== previous.database) throw new Error("Dependency plan database mismatch.");
    const candidates = previous.candidateCompanyIds.map(id => new mongoose.Types.ObjectId(id));
    const extraProtected = new Set<string>();
    // Preserve linked user notifications and any live/manual/non-automatic work.
    for await (const row of db.collection("notifications").find({}, { projection: { link: 1 } })) {
      for (const match of String(row.link ?? "").matchAll(/[a-f\d]{24}/gi)) extraProtected.add(match[0].toLowerCase());
    }
    const automaticReasons = ["new", "registry-change", "backfill", "retry"];
    for await (const row of db.collection("jobs").find({ $or: [{ status: "RUNNING" }, { "payload.reason": { $nin: automaticReasons } }, { "payload.manual": true }] }, { projection: { "payload.companyId": 1 } })) {
      if (mongoose.Types.ObjectId.isValid(String(row.payload?.companyId ?? ""))) extraProtected.add(String(row.payload.companyId));
    }
    const eligible = candidates.filter(id => !extraProtected.has(String(id)));
    const companyFilter = {
      _id: { $in: eligible }, registrationDay: { $type: "string", $regex: /^\d{4}-\d{2}-\d{2}$/, $lt: cutoffDay },
      "lead.relevanceBy": null, "lead.stageChangedAt": null, "lead.lastContactedAt": null, "lead.organizationId": null,
    };
    const companyRows = await db.collection("companies").find(companyFilter, { projection: { _id: 1, registrationDay: 1 } }).sort({ _id: 1 }).toArray();
    const ids = companyRows.map(row => row._id);
    const idStrings = ids.map(String);
    const parentIds = [...ids, ...idStrings];
    const filters: Record<string, mongoose.mongo.Filter<mongoose.mongo.Document>> = {
      companies: { _id: { $in: ids } },
      contacts: { companyId: { $in: parentIds }, sourceKind: { $ne: "MANUAL" }, review: { $ne: "APPROVED" }, reviewedBy: null },
      jobs: { type: "research", "payload.companyId": { $in: parentIds }, "payload.reason": { $in: automaticReasons }, "payload.manual": { $ne: true }, status: { $in: ["QUEUED", "FAILED", "DONE", "DEAD"] } },
      inboxitems: { companyId: { $in: parentIds } },
      established_companies: { foundedOn: { $type: "date", $lt: cutoffDate }, source: { $nin: ["manual", "MANUAL", "", null] } },
      registrysyncs: { status: { $in: ["SUCCESS", "PARTIAL", "FAILED"] }, finishedAt: { $type: "date", $lt: cutoffDate } },
      opportunitysyncruns: { status: { $in: ["SUCCESS", "PARTIAL", "FAILED", "SKIPPED"] }, finishedAt: { $type: "date", $lt: cutoffDate } },
      lookupcaches: { expiresAt: { $type: "date", $lt: new Date() } },
    };
    const entries = [];
    const exactIds: Record<string, string[]> = {};
    for (const [name, filter] of Object.entries(filters)) {
      const rows = await db.collection(name).find(filter, { projection: { _id: 1 } }).sort({ _id: 1 }).toArray();
      exactIds[name] = rows.map(row => String(row._id));
      const sizes = await db.collection(name).aggregate<{ bytes: number }>([
        { $match: filter }, { $group: { _id: null, bytes: { $sum: { $bsonSize: "$$ROOT" } } } },
      ], { maxTimeMS: 30000 }).toArray();
      entries.push({ collection: name, candidateCount: rows.length, logicalDocumentBytes: sizes[0]?.bytes ?? 0 });
    }
    const dates = companyRows.map(row => String(row.registrationDay)).sort();
    const plan = {
      capturedAt: new Date().toISOString(), database: db.databaseName, deletionApproved: false, databaseWrites: 0, cutoffDay,
      scope: "Optional phase 2: only old, unreferenced, non-manual source records and their automatic dependent work. All other collections/records preserved.",
      referenceAuditAt: previous.capturedAt, additionalProtectedReferenceCount: extraProtected.size,
      companyRegistrationRange: { oldest: dates[0] ?? null, newest: dates.at(-1) ?? null },
      protectedCandidateIntersection: ids.filter(id => extraProtected.has(String(id))).length,
      entries, candidateDocumentBytes: entries.reduce((total, row) => total + row.logicalDocumentBytes, 0), exactIds,
      invariants: ["No users, roles, password hashes, organizations or security records removed", "No running jobs or manual work removed", "Missing/invalid company dates preserved", "Recent company dates and reporting snapshots preserved", "No collection, index or TTL changes", "External verified backup and final exact-scope approval required", "Revalidate all dependencies and record versions with writers paused before deletion"],
    };
    const planSha256 = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
    await writeFile("storage/backups/storage-audit/retention-plan.json", JSON.stringify({ ...plan, planSha256 }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ ...plan, exactIds: "Saved only in ignored local plan", planSha256 }, null, 2));
  } finally { await client.close(); }
}
main().catch(error => { console.error("Read-only retention planning failed:", typeof error.code === "number" ? error.code : error.name); process.exitCode = 1; });
