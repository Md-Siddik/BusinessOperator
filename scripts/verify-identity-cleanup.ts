/** Read-only verification of the accepted local recovery point and exact target inventory. */
import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { configureMongoDns, hasExplicitMongoDatabase } from "../src/lib/db/configuration";
import { verifySourceBackup } from "./lib/source-backup";
import { fingerprint } from "./lib/selective-migration";
import type { CollectionSnapshot } from "./lib/identity-cleanup";

loadEnvConfig(process.cwd());
const bundlePath = "storage/backups/storage-audit/full-2026-11-07T11-43-11-802Z/bundle.json";
const keep = new Set(["users", "User", "organizations", "deletedidentities", "authratelimits", "systemsettings", "clientdeletions", "suppressionentries", "auditlogs", "counters", "countries"]);
async function main() {
  configureMongoDns();
  const uri = process.env.MONGODB_URI;
  if (!uri || !hasExplicitMongoDatabase(uri)) throw new Error("Explicit target database required.");
  const bundle = JSON.parse(await readFile(bundlePath, "utf8")) as { verified: boolean; databases: { database: string; manifest: string; verified: boolean }[] };
  if (!bundle.verified || JSON.stringify(bundle.databases.map(entry => entry.database).sort()) !== JSON.stringify(["ExploreTechify", "sample_mflix"]) || bundle.databases.some(entry => !entry.verified)) throw new Error("Complete verified recovery point required.");
  const client = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 12000, connectTimeoutMS: 8000 });
  try {
    await client.connect();
    if (client.db().databaseName !== "ExploreTechify") throw new Error("Unexpected target database. Stop.");
    const backups = [];
    for (const entry of bundle.databases) {
      console.log(JSON.stringify({ stage: "verify_backup", database: entry.database }));
      const manifest = await verifySourceBackup(client.db(entry.database), entry.manifest);
      backups.push({ database: entry.database, collections: manifest.collections.length, verified: true });
    }
    const preserved: CollectionSnapshot[] = [];
    const emptyCollections: CollectionSnapshot[] = [];
    const infos = await client.db().listCollections().toArray();
    for (const info of infos) {
      if (info.type !== "collection") throw new Error("Unexpected database object. Stop.");
      const fp = await fingerprint(client.db(), info.name);
      const row = { collection: info.name, ...fp };
      (keep.has(info.name) ? preserved : emptyCollections).push(row);
    }
    const requiredOrgIds = await client.db().collection("users").distinct("organizationId", { role: "CLIENT" });
    const linkedOrgCount = await client.db().collection("organizations").countDocuments({ _id: { $in: requiredOrgIds } });
    if (requiredOrgIds.some(id => !id) || linkedOrgCount !== requiredOrgIds.length) throw new Error("Client authentication dependency missing. Stop.");
    if (await client.db().collection("organizations").countDocuments({ companyId: { $ne: null } })) throw new Error("Retained organizations reference company records. Stop for dependency review.");
    const sample = await client.db("sample_mflix").listCollections().toArray();
    if (sample.some(info => info.type !== "collection")) throw new Error("Unexpected sample database object.");
    const sampleCollections = await Promise.all(sample.map(async info => ({ collection: info.name, ...await fingerprint(client.db("sample_mflix"), info.name) })));
    const report = {
      at: new Date().toISOString(), database: "ExploreTechify", hostFingerprint: createHash("sha256").update(new URL(uri).hostname.toLowerCase()).digest("hex"),
      productionTargetConfirmedByUser: false, deletionApprovedByUser: true, executableUntilTargetConfirmed: false, databaseWrites: 0,
      backupBundle: bundlePath, backupVerifiedAgainstCurrentSource: true, backups, preserved, emptyCollections, sampleCollections,
      clientOrganizationDependenciesValid: true, preservedOrganizationCompanyReferences: 0,
      sampleAuthenticationRelation: "Runtime auth models use the explicit ExploreTechify connection; no runtime code references sample_mflix. Atlas database-user authentication is separate from sample application documents.",
      allOtherDatabasesPreserved: ["admin", "local", "config"],
    };
    const planSha256 = createHash("sha256").update(JSON.stringify(report)).digest("hex");
    await writeFile("storage/backups/storage-audit/verified-identity-cleanup.json", JSON.stringify({ ...report, planSha256 }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ ...report, preserved: preserved.map(({ collection, count }) => ({ collection, count })), emptyCollections: emptyCollections.map(({ collection, count }) => ({ collection, count })), sampleCollections: sampleCollections.map(({ collection, count }) => ({ collection, count })), planSha256 }, null, 2));
  } finally { await client.close(); }
}
main().catch(error => { console.error("Cleanup verification failed; no deletion performed:", typeof error.code === "number" ? error.code : error.name); process.exitCode = 1; });
