import type mongoose from "mongoose";
import path from "node:path";
import { readBackupDocuments, type BackupManifest } from "./source-backup";
import { fingerprint } from "./selective-migration";

type Db = mongoose.mongo.Db;
export const IDENTITY_KEEP = new Set(["users", "User", "organizations", "deletedidentities", "authratelimits", "systemsettings", "clientdeletions", "suppressionentries", "auditlogs", "counters", "countries"]);
export const BUSINESS_DATA = new Set(["casestudies", "checkpoints", "clientdocuments", "clientservices", "companies", "contactrequests", "contacts", "conversations", "crmactivities", "dailyregistrationsnapshots", "emailcampaigns", "emailmessages", "emailtemplates", "established_companies", "followups", "inboxitems", "jobs", "leadassignments", "lookupcaches", "messages", "notifications", "opportunities", "opportunityevents", "opportunityfeeds", "opportunitysyncruns", "projects", "projecttasks", "providerusages", "quotations", "registrysyncs", "servicepackages", "services", "supporttickets", "translations", "webanalyticsdailies", "webconversions", "webeventkeys", "webpageviews", "websessions", "websiteaudits", "webvisitors"]);
export const SAMPLE_DATA = new Set(["embedded_movies", "sessions", "movies", "users", "comments", "theaters"]);
export type CollectionSnapshot = { collection: string; count: number; sha256: string };
export type CleanupScope = { database: string; preserved: CollectionSnapshot[]; emptyCollections: CollectionSnapshot[]; sampleCollections: CollectionSnapshot[] };
export type CleanupProgress = { database: string; collection?: string; deleted: number; complete: boolean };

export async function executeIdentityCleanup(db: Db, sample: Db, scope: CleanupScope, manifest: BackupManifest, directory: string, progress: (entry: CleanupProgress) => Promise<void>) {
  if (["admin", "local", "config", "sample_mflix"].includes(scope.database) || db.databaseName !== scope.database || sample.databaseName !== "sample_mflix" || db.client !== sample.client) throw new Error("Target mismatch.");
  if (!manifest.verified || !manifest.allCollections || manifest.database !== db.databaseName) throw new Error("Verified complete application backup required.");
  if (scope.emptyCollections.some(row => !BUSINESS_DATA.has(row.collection) || IDENTITY_KEEP.has(row.collection)) || scope.preserved.some(row => !IDENTITY_KEEP.has(row.collection)) || scope.sampleCollections.some(row => !SAMPLE_DATA.has(row.collection))) throw new Error("Unsafe collection scope.");
  const names = (await db.listCollections().toArray());
  const sampleNames = await sample.listCollections().toArray();
  const sorted = (items: string[]) => JSON.stringify(items.sort());
  if (names.some(row => row.type !== "collection") || sampleNames.some(row => row.type !== "collection") || sorted(names.map(row => row.name)) !== sorted([...scope.preserved, ...scope.emptyCollections].map(row => row.collection)) || sorted(sampleNames.map(row => row.name)) !== sorted(scope.sampleCollections.map(row => row.collection))) throw new Error("Database objects changed or unclassified.");
  if (sorted(manifest.collections.map(row => row.name)) !== sorted(names.map(row => row.name))) throw new Error("Backup coverage mismatch.");
  for (const row of scope.emptyCollections) {
    const entry = manifest.collections.find(item => item.name === row.collection);
    if (!entry || !/^\d{4}\.bson\.gz$/.test(entry.file) || entry.count !== row.count || entry.sha256 !== row.sha256) throw new Error("Backup snapshot mismatch.");
  }
  // Preflight every collection before the first delete. Authentication changes
  // or newly arrived business data invalidate this snapshot and stop execution.
  for (const row of [...scope.preserved, ...scope.emptyCollections]) {
    if (JSON.stringify(await fingerprint(db, row.collection)) !== JSON.stringify({ count: row.count, sha256: row.sha256 })) throw new Error("Application source changed since verification.");
  }
  for (const row of scope.sampleCollections) {
    if (JSON.stringify(await fingerprint(sample, row.collection)) !== JSON.stringify({ count: row.count, sha256: row.sha256 })) throw new Error("Sample source changed since verification.");
  }
  if (await db.collection("organizations").countDocuments({ companyId: { $ne: null } })) throw new Error("Preserved organization company dependency detected.");
  await progress({ database: db.databaseName, deleted: 0, complete: false });
  const order = [...scope.emptyCollections].sort((a, b) => a.collection === "jobs" ? -1 : b.collection === "jobs" ? 1 : a.collection.localeCompare(b.collection));
  for (const row of order) {
    const entry = manifest.collections.find(item => item.name === row.collection);
    if (!entry || !/^\d{4}\.bson\.gz$/.test(entry.file) || entry.count !== row.count || entry.sha256 !== row.sha256) throw new Error("Backup snapshot mismatch.");
    let batch: mongoose.mongo.Document["_id"][] = [];
    let deleted = 0;
    const flush = async () => {
      if (!batch.length) return;
      const result = await db.collection(row.collection).deleteMany({ _id: { $in: batch } }, { writeConcern: { w: "majority", wtimeoutMS: 10000 }, maxTimeMS: 30000 });
      deleted += result.deletedCount;
      if (result.deletedCount !== batch.length) throw new Error("Concurrent business modification detected; cleanup paused.");
      batch = [];
      await progress({ database: db.databaseName, collection: row.collection, deleted, complete: false });
    };
    // Only backed-up IDs can be deleted. Newly created records are not selected.
    for await (const doc of readBackupDocuments(path.join(directory, entry.file))) {
      batch.push(doc._id);
      if (batch.length === 500) await flush();
    }
    await flush();
    if (deleted !== row.count) throw new Error("Deleted count does not match verified backup.");
    await progress({ database: db.databaseName, collection: row.collection, deleted, complete: true });
  }
  for (const row of scope.preserved) {
    if (JSON.stringify(await fingerprint(db, row.collection)) !== JSON.stringify({ count: row.count, sha256: row.sha256 })) throw new Error("Preserved collection changed; stop for review.");
  }
  // The unused sample database is separate from all application identities.
  // Recheck immediately before the single explicitly named database drop.
  for (const row of scope.sampleCollections) {
    if (JSON.stringify(await fingerprint(sample, row.collection)) !== JSON.stringify({ count: row.count, sha256: row.sha256 })) throw new Error("Sample source changed; database was not dropped.");
  }
  await sample.dropDatabase({ writeConcern: { w: "majority", wtimeoutMS: 10000 } });
  await progress({ database: "sample_mflix", deleted: scope.sampleCollections.reduce((sum, row) => sum + row.count, 0), complete: true });
}
