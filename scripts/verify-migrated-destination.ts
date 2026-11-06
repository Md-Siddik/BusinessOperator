/** Verification only: business write probes are rolled back, never committed. */
import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { mkdir, writeFile } from "node:fs/promises";
import { configureMongoDns } from "../src/lib/db/configuration";
import { canonical } from "./lib/selective-migration";
loadEnvConfig(process.cwd());

async function main() {
  if (!process.env.OLD_MONGODB_URI || !process.env.NEW_MONGODB_URI) throw new Error("Both migration URIs are required.");
  configureMongoDns();
  const source = new mongoose.mongo.MongoClient(process.env.OLD_MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const target = new mongoose.mongo.MongoClient(process.env.NEW_MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    await Promise.all([source.connect(), target.connect()]);
    const oldDb = source.db(), db = target.db();
    if (db.databaseName !== oldDb.databaseName) throw new Error("Unexpected destination database.");
    let users = 0, bcryptCompatibleUsers = 0;
    for await (const original of oldDb.collection("users").find({}, { promoteValues: false })) {
      const migrated = await db.collection("users").findOne({ _id: original._id }, { promoteValues: false });
      if (!migrated || canonical(original) !== canonical(migrated)) throw new Error("A user account differs from the source.");
      if (original.organizationId && !await db.collection("organizations").findOne({ _id: original.organizationId })) throw new Error("A user's organization relationship is missing.");
      if (typeof migrated.passwordHash === "string" && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(migrated.passwordHash)) bcryptCompatibleUsers++;
      users++;
    }
    if (await db.collection("users").countDocuments() !== users) throw new Error("User account counts do not match.");
    const companyCount = await db.collection("companies").countDocuments();
    const hiringCount = await db.collection("opportunities").countDocuments();
    const session = target.startSession();
    const companyId = new mongoose.Types.ObjectId(), jobId = new mongoose.Types.ObjectId();
    let companyWriteVerified = false, jobWriteVerified = false;
    try {
      session.startTransaction();
      await db.collection("companies").insertOne({ _id: companyId, companyName: "Synthetic migration write probe", countryCode: "NO", source: "migration-verification", sourceId: String(companyId), isDemo: true, registrationDay: "2026-11-06" }, { session });
      companyWriteVerified = !!await db.collection("companies").findOne({ _id: companyId }, { session });
      await db.collection("opportunities").insertOne({ _id: jobId, providerId: "migration-verification", externalId: String(jobId), type: "HIRING", title: "Synthetic migration write probe", isCanonical: true, firstSeenAt: new Date() }, { session });
      jobWriteVerified = !!await db.collection("opportunities").findOne({ _id: jobId }, { session });
    } finally { if (session.inTransaction()) await session.abortTransaction(); await session.endSession(); }
    if (await db.collection("companies").countDocuments() !== companyCount || await db.collection("opportunities").countDocuments() !== hiringCount || await db.collection("companies").findOne({ _id: companyId }) || await db.collection("opportunities").findOne({ _id: jobId })) throw new Error("Synthetic transaction rollback verification failed.");
    const stats = await db.stats();
    const report = {
      at: new Date().toISOString(), verifiedDatabase: db.databaseName, usersPreservedExactly: users,
      passwordsRolesPermissionsAndIdsUnchanged: true, organizationRelationshipsVerified: true,
      bcryptCompatibleUsers,
      companyRecords: companyCount, establishedCompanyRecords: await db.collection("established_companies").countDocuments(), historicalJobs: hiringCount,
      companyWriteVerified, jobWriteVerified, syntheticWritesCommitted: 0,
      runtimeSwitched: false, realPasswordLoginVerified: false,
      storage: { logicalDocumentBytes: stats.dataSize, allocatedDocumentBytes: stats.storageSize, indexBytes: stats.indexSize, collections: stats.collections },
    };
    await mkdir("storage/backups/migration", { recursive: true });
    await writeFile("storage/backups/migration/destination-verification.json", JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(report, null, 2));
  } finally { await Promise.allSettled([source.close(), target.close()]); }
}
main().catch(() => { console.error("Destination verification failed. No runtime switch was approved. Synthetic business probes are rolled back."); process.exitCode = 1; });
