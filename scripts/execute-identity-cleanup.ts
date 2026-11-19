/** Explicit operator-approved identity-only cleanup. No application deployment required. */
import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { configureMongoDns } from "../src/lib/db/configuration";
import { executeIdentityCleanup, IDENTITY_KEEP, BUSINESS_DATA, type CleanupScope, type CollectionSnapshot, type CleanupProgress } from "./lib/identity-cleanup";
import { fingerprint } from "./lib/selective-migration";
import type { BackupManifest } from "./lib/source-backup";

loadEnvConfig(process.cwd());
async function main() {
  if (process.argv.slice(2).join(" ") !== "--confirmed-production-target-and-user-authorized") throw new Error("Explicit confirmed production-target and user authorization flag required.");
  configureMongoDns();
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI required.");
  const verified = JSON.parse(await readFile("storage/backups/storage-audit/verified-identity-cleanup.json", "utf8")) as CleanupScope & { at: string; hostFingerprint: string; backupBundle: string; backupVerifiedAgainstCurrentSource: boolean };
  if (!verified.backupVerifiedAgainstCurrentSource || Date.now() - Date.parse(verified.at) > 3_600_000 || verified.database !== "ExploreTechify" || createHash("sha256").update(new URL(uri).hostname.toLowerCase()).digest("hex") !== verified.hostFingerprint) throw new Error("Fresh verified target snapshot required.");
  const all: CollectionSnapshot[] = [...verified.preserved, ...verified.emptyCollections];
  if (all.some(row => !IDENTITY_KEEP.has(row.collection) && !BUSINESS_DATA.has(row.collection))) throw new Error("Unclassified collection.");
  const scope: CleanupScope = { database: verified.database, preserved: all.filter(row => IDENTITY_KEEP.has(row.collection)), emptyCollections: all.filter(row => BUSINESS_DATA.has(row.collection)), sampleCollections: verified.sampleCollections };
  const bundle = JSON.parse(await readFile(verified.backupBundle, "utf8")) as { databases: { database: string; manifest: string }[] };
  const application = bundle.databases.find(entry => entry.database === scope.database);
  if (!application) throw new Error("Application recovery point missing.");
  const manifest = mongoose.mongo.BSON.EJSON.parse(await readFile(application.manifest, "utf8")) as BackupManifest;
  const client = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 12000, connectTimeoutMS: 8000 });
  const journalPath = `storage/backups/storage-audit/cleanup-execution-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.json`;
  const journal: { startedAt: string; database: string; authorization: string; backupBundle: string; preserved: CollectionSnapshot[]; progress: CleanupProgress[]; status: string; verification?: unknown } = { startedAt: new Date().toISOString(), database: scope.database, authorization: "User explicitly authorized non-user business deletion after safety checks and confirmed matching production host/database.", backupBundle: verified.backupBundle, preserved: scope.preserved, progress: [], status: "preflight" };
  const save = () => writeFile(journalPath, JSON.stringify(journal, null, 2), { mode: 0o600 });
  try {
    await client.connect();
    if (client.db().databaseName !== scope.database) throw new Error("URI database mismatch.");
    await save();
    await executeIdentityCleanup(client.db(), client.db("sample_mflix"), scope, manifest, path.dirname(application.manifest), async entry => {
      const index = journal.progress.findIndex(row => row.database === entry.database && row.collection === entry.collection);
      if (index < 0) journal.progress.push(entry); else journal.progress[index] = entry;
      journal.status = "executing";
      await save();
      if (entry.complete) console.log(JSON.stringify(entry));
    });
    const preserved = [];
    for (const row of scope.preserved) preserved.push({ collection: row.collection, unchanged: JSON.stringify(await fingerprint(client.db(), row.collection)) === JSON.stringify({ count: row.count, sha256: row.sha256 }) });
    const remainingBusiness = [];
    for (const row of scope.emptyCollections) remainingBusiness.push({ collection: row.collection, count: await client.db().collection(row.collection).countDocuments() });
    const stats = await client.db().command({ dbStats: 1, scale: 1 });
    journal.verification = { preserved, remainingBusiness, applicationDataAndIndexBytes: stats.dataSize + stats.indexSize, sampleCollectionsRemaining: (await client.db("sample_mflix").listCollections().toArray()).length };
    journal.status = preserved.every(row => row.unchanged) && remainingBusiness.every(row => row.count === 0) ? "complete" : "verification_required";
    await save();
    console.log(JSON.stringify({ journalPath, ...journal }, null, 2));
    if (journal.status !== "complete") process.exitCode = 1;
  } catch (error) {
    journal.status = "stopped";
    await save();
    console.error("Cleanup stopped; inspect local execution journal:", journalPath, typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : (error as Error).name);
    process.exitCode = 1;
  } finally { await client.close(); }
}
main().catch(error => { console.error("Cleanup preflight failed; no deletion started:", error.name); process.exitCode = 1; });
