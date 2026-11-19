/** Read-only candidate inventory. No deletion commands are implemented here. */
import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { mkdir, writeFile } from "node:fs/promises";
import { configureMongoDns } from "../src/lib/db/configuration";
loadEnvConfig(process.cwd());
async function main() {
  configureMongoDns();
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required.");
  const client = new mongoose.mongo.MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 12000 });
  try {
    await client.connect();
    const db = client.db();
    const protectedIds = new Map<string, mongoose.Types.ObjectId>();
    const references: Record<string, number> = {};
    for (const info of await db.listCollections({ type: "collection" }).toArray()) {
      if (["companies", "contacts", "jobs", "inboxitems", "checkpoints", "dailyregistrationsnapshots", "registrysyncs"].includes(info.name)) continue;
      let count = 0;
      for await (const row of db.collection(info.name).find({ companyId: { $type: "objectId" } }, { projection: { companyId: 1 } })) {
        protectedIds.set(String(row.companyId), row.companyId); count++;
      }
      if (count) references[info.name] = count;
    }
    const manualContactIds = await db.collection("contacts").distinct("companyId", { $or: [{ sourceKind: "MANUAL" }, { review: "APPROVED" }, { reviewedBy: { $ne: null } }] });
    for (const id of manualContactIds) if (id) protectedIds.set(String(id), id);
    const used = await db.collection("companies").find({ $or: [{ "lead.saved": true }, { "lead.assignedTo": { $ne: null } }, { "lead.stage": { $nin: ["NEW", "RESEARCHING", "CONTACT_AVAILABLE", null] } }, { "companyType.manual": true }, { "eligibility.by": { $ne: null } }, ...["email", "phone", "mobile", "website", "contactPerson"].map(field => ({ [`contactSources.${field}.kind`]: "MANUAL" }))] }, { projection: { _id: 1 } }).toArray();
    for (const row of used) protectedIds.set(String(row._id), row._id);
    const filter = { _id: { $nin: [...protectedIds.values()] }, source: { $nin: ["manual", "MANUAL", "", null] } };
    const candidateIds = await db.collection("companies").find(filter, { projection: { _id: 1 } }).toArray();
    const report = { database: db.databaseName, capturedAt: new Date().toISOString(), deletionApproved: false, databaseWrites: 0, protectedCompanyCount: protectedIds.size, essentialReferences: references, candidateCompanyCount: candidateIds.length, candidateCompanyIds: candidateIds.map(row => String(row._id)), associatedContactCount: await db.collection("contacts").countDocuments({ companyId: { $in: candidateIds.map(row => row._id) } }), establishedCompanyCount: await db.collection("established_companies").countDocuments(), jobTypes: await db.collection("jobs").aggregate([{ $group: { _id: { type: "$type", status: "$status", reason: "$payload.reason" }, count: { $sum: 1 } } }]).toArray(), reviewRequired: "Candidates are not approved for deletion. Preserve all marketer assignments (including withdrawn/merged history), referenced companies, manual data, users, authentication, settings and essential application records. Reverify backup and recompute references immediately before any approved cleanup." };
    await mkdir("storage/backups/storage-audit", { recursive: true });
    await writeFile("storage/backups/storage-audit/cleanup-plan.json", JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ ...report, candidateCompanyIds: `[${candidateIds.length} IDs written to ignored local plan]` }, null, 2));
  } finally { await client.close(); }
}
main().catch(error => { console.error("Cleanup planning failed:", error.code ?? error.name); process.exitCode = 1; });
