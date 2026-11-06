import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import path from "node:path";
import { configureMongoDns } from "../src/lib/db/configuration";
import { createSourceBackup } from "./lib/source-backup";
loadEnvConfig(process.cwd());
async function main() {
  if (!process.argv.includes("--source-frozen")) throw new Error("Pause identified writers before passing --source-frozen.");
  if (!process.env.OLD_MONGODB_URI) throw new Error("OLD_MONGODB_URI is required.");
  configureMongoDns();
  const source = new mongoose.mongo.MongoClient(process.env.OLD_MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    await source.connect();
    const directory = path.join(process.cwd(), "storage", "backups", "migration", `source-${Date.now()}`);
    const manifest = await createSourceBackup(source.db(), directory);
    console.info(JSON.stringify({ verifiedBackupManifest: manifest, sourceDatabaseUnchanged: true }));
  } finally { await source.close(); }
}
main().catch(() => { console.error("Source backup failed verification; no migration was performed. No credentials or record contents were logged."); process.exitCode = 1; });
