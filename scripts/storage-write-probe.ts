/** Explicit disposable write probe. Existing users/security documents are never changed. */
import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { configureMongoDns, hasExplicitMongoDatabase } from "../src/lib/db/configuration";
import { isDatabaseCapacityError } from "../src/lib/db/errors";
import { fingerprint } from "./lib/selective-migration";

loadEnvConfig(process.cwd());
async function main() {
  if (process.argv.slice(2).join(" ") !== "--confirm-probe") throw new Error("Pass --confirm-probe to permit one new disposable TTL diagnostic record.");
  configureMongoDns();
  const uri = process.env.MONGODB_URI;
  if (!uri || !hasExplicitMongoDatabase(uri)) throw new Error("An explicit database connection is required.");
  const client = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 12000, connectTimeoutMS: 8000, timeoutMS: 15000 });
  try {
    await client.connect();
    const db = client.db();
    const bucket = db.collection<{ _id: string; count: number; expiresAt: Date }>("authratelimits");
    const indexes = await bucket.listIndexes().toArray();
    if (!indexes.some(index => index.key.expiresAt === 1 && Object.keys(index.key).length === 1 && index.expireAfterSeconds === 0 && !index.partialFilterExpression)) throw new Error("Existing full expiresAt TTL index is required; no index will be created.");
    const before = await fingerprint(db, "users");
    const id = `diagnostic:capacity:${randomUUID()}`;
    const report: Record<string, unknown> = { at: new Date().toISOString(), database: db.databaseName, productionConnectionVerified: false, ping: (await db.command({ ping: 1 })).ok === 1, existingDocumentsModified: 0, cleanupPerformed: false };
    try {
      await bucket.insertOne({ _id: id, count: 0, expiresAt: new Date(Date.now() + 60_000) }, { writeConcern: { w: "majority", wtimeoutMS: 5000 } });
      report.writeSucceeded = true;
      report.readBackSucceeded = (await bucket.findOne({ _id: id }))?.count === 0;
      report.expiry = "One newly created diagnostic bucket expires under the existing TTL policy; no manual delete is performed.";
    } catch (error) {
      const e = error as { name?: string; code?: number };
      report.writeSucceeded = false;
      report.errorType = e.name;
      report.errorCode = e.code;
      report.storageQuotaFailure = isDatabaseCapacityError(error);
    }
    report.usersUnchanged = JSON.stringify(before) === JSON.stringify(await fingerprint(db, "users"));
    await writeFile("storage/backups/storage-audit/write-probe.json", JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(report, null, 2));
    if (!report.writeSucceeded || !report.readBackSucceeded || !report.usersUnchanged) process.exitCode = 1;
  } finally { await client.close(); }
}
main().catch(error => { console.error("Write probe failed:", error.code ?? error.name); process.exitCode = 1; });
