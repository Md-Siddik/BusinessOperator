/** Full BSON backup, read-back checksums and live-source verification. No database writes. */
import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { configureMongoDns, hasExplicitMongoDatabase } from "../src/lib/db/configuration";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSourceBackup, verifySourceBackup } from "./lib/source-backup";
loadEnvConfig(process.cwd());
async function main() {
  configureMongoDns();
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required.");
  if (!hasExplicitMongoDatabase(process.env.MONGODB_URI)) throw new Error("MONGODB_URI must include the intended database name.");
  if (process.argv.slice(2).some(arg => arg !== "--include-sample")) throw new Error("Only --include-sample is supported.");
  const client = new mongoose.mongo.MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 12000 });
  try {
    await client.connect();
    const directory = `storage/backups/storage-audit/full-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
    const names = [client.db().databaseName, ...(process.argv.includes("--include-sample") ? ["sample_mflix"] : [])];
    const databases = [];
    for (const name of [...new Set(names)]) {
      const db = client.db(name);
      const infos = await db.listCollections().toArray();
      if (infos.some(info => info.type !== "collection")) throw new Error("Non-collection objects require a separate backup review.");
      const manifest = await createSourceBackup(db, path.join(directory, name), true);
      await verifySourceBackup(db, manifest);
      databases.push({ database: name, manifest, verified: true });
    }
    // A bundle is marked complete only after both databases pass verification.
    await mkdir(directory, { recursive: true });
    const bundle = { capturedAt: new Date().toISOString(), verified: true, databaseWrites: 0, scope: "Configured connection; production connection equivalence must be verified separately.", databases };
    const bundlePath = path.join(directory, "bundle.json");
    await writeFile(bundlePath, JSON.stringify(bundle, null, 2), { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ ...bundle, bundlePath }));
  } finally { await client.close(); }
}
main().catch(error => { console.error("Full backup failed; do not delete data:", error.code ?? error.name); process.exitCode = 1; });
