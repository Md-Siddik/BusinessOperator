/** Read-only inventory. Never seeds, builds indexes, updates, or deletes data. */
import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { mkdir, writeFile } from "node:fs/promises";
import { configureMongoDns, hasExplicitMongoDatabase } from "../src/lib/db/configuration";

loadEnvConfig(process.cwd());
async function main() {
  configureMongoDns();
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required; no fallback database will be inspected.");
  if (!hasExplicitMongoDatabase(process.env.MONGODB_URI)) throw new Error("MONGODB_URI must include the intended database name.");
  const client = new mongoose.mongo.MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 12000 });
  try {
    await client.connect();
    const db = client.db();
    const stats = await db.command({ dbStats: 1, scale: 1 });
    const collections = [];
    for (const info of await db.listCollections({ type: "collection" }).toArray()) {
      const s = await db.command({ collStats: info.name, scale: 1 });
      collections.push({ name: info.name, count: s.count, dataBytes: s.size, storageBytes: s.storageSize, indexBytes: s.totalIndexSize });
    }
    collections.sort((a, b) => b.storageBytes + b.indexBytes - a.storageBytes - a.indexBytes);
    // Atlas Free/Flex quota accounting uses uncompressed data + indexes, not
    // WiredTiger's compressed allocation. Include other authorized databases
    // without claiming that database credentials expose the entire cluster.
    let accessibleDatabases;
    try {
      const listed = await client.db("admin").command({ listDatabases: 1, nameOnly: true, authorizedDatabases: true });
      accessibleDatabases = await Promise.all(listed.databases.map(async (entry: { name: string }) => {
        try {
          const s = entry.name === db.databaseName ? stats : await client.db(entry.name).command({ dbStats: 1, scale: 1 });
          const otherCollections = entry.name === db.databaseName ? undefined : await Promise.all(
            (await client.db(entry.name).listCollections({ type: "collection" }).toArray()).map(async info => {
              const c = await client.db(entry.name).command({ collStats: info.name, scale: 1 });
              return { name: info.name, count: c.count, dataAndIndexBytes: c.size + c.totalIndexSize };
            }),
          );
          return { database: entry.name, dataAndIndexBytes: s.dataSize + s.indexSize, collections: otherCollections };
        } catch { return { database: entry.name, statisticsUnavailable: true }; }
      }));
    } catch { accessibleDatabases = null; }
    const report = { capturedAt: new Date().toISOString(), database: db.databaseName, dataBytes: stats.dataSize, storageBytes: stats.storageSize, indexBytes: stats.indexSize, allocatedDataAndIndexBytes: stats.storageSize + stats.indexSize, dataAndIndexBytes: stats.dataSize + stats.indexSize, clusterLimitBytes: null, coverage: "Authorized databases only; Atlas tier, cluster-wide visibility and production connection equivalence are not verified.", accessibleDatabases, collections };
    await mkdir("storage/backups/storage-audit", { recursive: true });
    await writeFile("storage/backups/storage-audit/inventory.json", JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(report, null, 2));
  } finally { await client.close(); }
}
main().catch(error => { console.error("Storage inspection failed:", error.code ?? error.name); process.exitCode = 1; });
