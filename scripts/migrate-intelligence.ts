import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { inventory, migrateSelected } from "./lib/selective-migration";
import { configureMongoDns, hasExplicitMongoDatabase } from "../src/lib/db/configuration";
import { verifySourceBackup } from "./lib/source-backup";

loadEnvConfig(process.cwd());
async function main() {
  const oldUri = process.env.OLD_MONGODB_URI;
  const newUri = process.env.NEW_MONGODB_URI || process.env.MONGODB_URI;
  if (!oldUri || !newUri) throw new Error("Configure OLD_MONGODB_URI and NEW_MONGODB_URI (or MONGODB_URI as destination).");
  if (!hasExplicitMongoDatabase(oldUri) || !hasExplicitMongoDatabase(newUri)) throw new Error("Explicit database names are required in both URIs before connecting.");
  configureMongoDns();
  if (oldUri === newUri) throw new Error("Source and destination must differ.");
  const apply = process.argv.includes("--apply");
  if (apply && !process.argv.includes("--source-frozen")) throw new Error("Pause all source AND destination writers first, then pass --apply --source-frozen. Inspection is read-only by default.");
  const backupIndex = process.argv.indexOf("--backup-manifest");
  const backupManifest = backupIndex >= 0 ? process.argv[backupIndex + 1] : undefined;
  if (apply && !backupManifest) throw new Error("A verified --backup-manifest is required before migration writes.");
  const source = new mongoose.mongo.MongoClient(oldUri, { serverSelectionTimeoutMS: 15000 });
  const target = new mongoose.mongo.MongoClient(newUri, { serverSelectionTimeoutMS: 15000 });
  try {
    await Promise.all([source.connect(), target.connect()]);
    const sourceDb = source.db(), targetDb = target.db();
    if (sourceDb.databaseName === "test" || targetDb.databaseName === "test") throw new Error("Explicit database names are required in both URIs.");
    const [sourceHello, targetHello] = await Promise.all([sourceDb.admin().command({ hello: 1 }), targetDb.admin().command({ hello: 1 })]);
    const sameServer = sourceHello.topologyVersion?.processId && String(sourceHello.topologyVersion.processId) === String(targetHello.topologyVersion?.processId);
    const sameReplicaSet = sourceHello.setName && sourceHello.setName === targetHello.setName && sourceHello.hosts?.some((host: string) => targetHello.hosts?.includes(host));
    const sameSeed = source.options.hosts.some(host => target.options.hosts.some(other => String(host) === String(other)));
    if (sourceDb.databaseName === targetDb.databaseName && (sameServer || sameReplicaSet || sameSeed)) throw new Error("Source and destination resolve to the same database.");
    const before = { source: await inventory(sourceDb), destination: await inventory(targetDb) };
    if (apply) await verifySourceBackup(sourceDb, backupManifest!);
    const migration = apply ? await migrateSelected(sourceDb, targetDb, { continueBusinessErrors: process.argv.includes("--continue-business-errors"), onProgress: row => console.info(JSON.stringify({ migrationProgress: row })) }) : null;
    const report = { at: new Date().toISOString(), mode: apply ? "apply" : "read-only", before, migration, after: apply ? await inventory(targetDb) : null, productionCutoverApproved: false, notes: "No URI, password hash or business record values are included. Live login and application checks are still required. No database connection setting was changed." };
    const dir = path.join(process.cwd(), "storage", "backups", "migration");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `report-${Date.now()}.json`);
    await writeFile(file, JSON.stringify(report, null, 2), { mode: 0o600 });
    console.info(JSON.stringify(report, null, 2));
    console.info(`Report saved: ${file}`);
  } finally { await Promise.allSettled([source.close(), target.close()]); }
}
main().catch(error => {
  // Driver error messages can contain hostnames/URIs. Only print our controlled validation errors.
  console.error(error?.constructor === Error ? error.message.replace(/mongodb(?:\+srv)?:\/\/\S+/g, "[redacted]") : "Database operation failed. Check private connection settings and database permissions; no cutover was performed.");
  process.exitCode = 1;
});
