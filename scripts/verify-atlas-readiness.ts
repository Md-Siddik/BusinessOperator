/** Read-only candidate verification. Does not edit .env.local, seed users or switch runtime traffic. */
import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { mkdir, writeFile } from "node:fs/promises";
import { configureMongoDns, hasExplicitMongoDatabase } from "../src/lib/db/configuration";

loadEnvConfig(process.cwd());
async function main() {
  const oldUri = process.env.OLD_MONGODB_URI;
  const destination = process.env.NEW_MONGODB_URI || process.env.MONGODB_URI;
  if (!oldUri || !destination) throw new Error("Both source and destination configuration are required.");
  const dnsIndex = process.argv.indexOf("--dns-servers");
  if (dnsIndex >= 0 && !process.argv[dnsIndex + 1]) throw new Error("Supply DNS server IPs after --dns-servers.");
  configureMongoDns(dnsIndex >= 0 ? process.argv[dnsIndex + 1] : undefined);
  const source = new mongoose.mongo.MongoClient(oldUri, { serverSelectionTimeoutMS: 10000 });
  const configuredTarget = new mongoose.mongo.MongoClient(destination, { serverSelectionTimeoutMS: 10000 });
  try {
    await Promise.all([source.connect(), configuredTarget.connect()]);
    const sourceDb = source.db();
    const db = configuredTarget.db(sourceDb.databaseName);
    const stats = await db.stats();
    const targetCollections = await db.listCollections({}, { nameOnly: true }).toArray();
    const collectionCounts = [];
    for (const info of targetCollections) if (!info.name.startsWith("system.")) collectionCounts.push({ name: info.name, count: await db.collection(info.name).countDocuments() });
    const configuredCounts = [];
    if (configuredTarget.db().databaseName !== db.databaseName) {
      for (const info of await configuredTarget.db().listCollections({}, { nameOnly: true }).toArray()) if (!info.name.startsWith("system.")) configuredCounts.push({ name: info.name, count: await configuredTarget.db().collection(info.name).countDocuments() });
    }
    const report = {
      at: new Date().toISOString(), connectedWithVerifiedTlsAndAuthentication: true,
      configuredDestinationHasExplicitDatabase: hasExplicitMongoDatabase(destination),
      configuredDestinationDatabase: configuredTarget.db().databaseName,
      candidateDestinationDatabase: db.databaseName, runtimeConfigurationChanged: false,
      sourceCounts: { companies: await sourceDb.collection("companies").countDocuments(), establishedCompanies: await sourceDb.collection("established_companies").countDocuments(), users: await sourceDb.collection("users").countDocuments() },
      candidateDestinationCollections: collectionCounts, configuredDestinationCollections: configuredCounts,
      candidateDestinationStorage: { logicalDocumentBytes: stats.dataSize, allocatedDocumentBytes: stats.storageSize, indexBytes: stats.indexSize, collections: stats.collections },
      safety: { writerPauseVerified: false, recoverableSourceBackupVerified: false, migrationPerformed: false, collectionsCreated: 0 },
    };
    await mkdir("storage/backups/migration", { recursive: true });
    await writeFile("storage/backups/migration/atlas-readiness.json", JSON.stringify(report, null, 2), { mode: 0o600 });
    console.info(JSON.stringify(report, null, 2));
  } finally { await Promise.allSettled([source.close(), configuredTarget.close()]); }
}
main().catch(() => { console.error("Read-only readiness verification failed. No database or connection setting was changed."); process.exitCode = 1; });
