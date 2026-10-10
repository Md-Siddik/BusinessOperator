/**
 * Copy the local development database (.data/mongo) to the database in MONGODB_URI
 * (e.g. MongoDB Atlas). Collections, documents and indexes are copied as-is.
 *
 *   npm run db:migrate-to-atlas           → refuses if the target already has data
 *   npm run db:migrate-to-atlas -- --drop → drops target collections first
 *
 * Run it BEFORE starting `npm run dev` against Atlas — the dev server would
 * otherwise auto-seed the empty Atlas database with dev accounts.
 */
import { loadEnvConfig } from "@next/env";
import path from "node:path";
import fs from "node:fs";
import mongoose from "mongoose";

const { MongoClient } = mongoose.mongo;
type MongoClient = mongoose.mongo.MongoClient;
type Db = mongoose.mongo.Db;

loadEnvConfig(process.cwd());

const LOCAL_DB_PORT = Number(process.env.LOCAL_DB_PORT || 27027);
const LOCAL_DB_NAME = "exploretechify";
const LOCAL_URI = `mongodb://127.0.0.1:${LOCAL_DB_PORT}/${LOCAL_DB_NAME}`;
const BATCH_SIZE = 1000;

async function openSource(): Promise<{ client: MongoClient; stop: () => Promise<unknown> }> {
  const client = new MongoClient(LOCAL_URI, { serverSelectionTimeoutMS: 1500 });
  try {
    // The dev server may already be running the local DB.
    await client.connect();
    return { client, stop: () => client.close() };
  } catch {
    await client.close().catch(() => undefined);
  }
  const dbPath = path.join(process.cwd(), ".data", "mongo");
  if (!fs.existsSync(dbPath)) throw new Error(`No local database found at ${dbPath}`);
  const { MongoMemoryServer } = await import("mongodb-memory-server");
  const server = await MongoMemoryServer.create({
    instance: { dbPath, port: LOCAL_DB_PORT, storageEngine: "wiredTiger", dbName: LOCAL_DB_NAME },
  });
  const started = new MongoClient(LOCAL_URI);
  await started.connect();
  return {
    client: started,
    stop: async () => {
      await started.close();
      await server.stop({ doCleanup: false });
    },
  };
}

async function userCollections(db: Db) {
  const infos = await db.listCollections({ type: "collection" }).toArray();
  return infos.filter((c) => !c.name.startsWith("system."));
}

async function main() {
  const drop = process.argv.includes("--drop");
  const targetUri = process.env.MONGODB_URI;
  if (!targetUri) throw new Error("Set MONGODB_URI (your Atlas connection string) in .env.local first.");
  if (targetUri.includes(`:${LOCAL_DB_PORT}/`)) throw new Error("MONGODB_URI points at the local database.");

  const target = new MongoClient(targetUri, { serverSelectionTimeoutMS: 15_000 });
  await target.connect();
  // Same database the app will use: the one named in the URI path (driver default "test").
  const targetDb = target.db();
  console.info(`Target database: "${targetDb.databaseName}"`);
  if (targetDb.databaseName === "test") {
    console.warn(`  ⚠ No database name in MONGODB_URI. Add one, e.g. ...mongodb.net/${LOCAL_DB_NAME}?retryWrites=true`);
  }

  const existing = [];
  for (const c of await userCollections(targetDb)) {
    if ((await targetDb.collection(c.name).estimatedDocumentCount()) > 0) existing.push(c.name);
  }
  if (existing.length && !drop) {
    await target.close();
    throw new Error(`Target already has data in: ${existing.join(", ")}. Re-run with --drop to replace it.`);
  }

  const source = await openSource();
  const sourceDb = source.client.db(LOCAL_DB_NAME);
  const collections = await userCollections(sourceDb);
  console.info(`Copying ${collections.length} collections from ${LOCAL_URI}`);

  let failed = false;
  for (const info of collections) {
    const name = info.name;
    if (drop) await targetDb.collection(name).drop().catch(() => undefined);
    // Keep collection options (validators, collation, capped…), minus server-assigned ones.
    const { idIndex: _idIndex, ...options } = (info as { options?: Record<string, unknown> }).options ?? {};
    void _idIndex;
    await targetDb.createCollection(name, options).catch(() => undefined);

    const src = sourceDb.collection(name);
    const dst = targetDb.collection(name);
    let copied = 0;
    let batch: Record<string, unknown>[] = [];
    for await (const doc of src.find({})) {
      batch.push(doc);
      if (batch.length >= BATCH_SIZE) {
        await dst.insertMany(batch, { ordered: false });
        copied += batch.length;
        batch = [];
      }
    }
    if (batch.length) {
      await dst.insertMany(batch, { ordered: false });
      copied += batch.length;
    }

    const indexes = (await src.listIndexes().toArray()).filter((i) => i.name !== "_id_");
    for (const { key, v: _v, ns: _ns, ...indexOptions } of indexes) {
      void _v;
      void _ns;
      await dst.createIndex(key, indexOptions).catch((err) => {
        console.warn(`  ⚠ ${name}: index ${indexOptions.name} not created — ${err.message}`);
      });
    }

    const total = await dst.countDocuments();
    const ok = total === copied;
    if (!ok) failed = true;
    console.info(`  ${ok ? "✓" : "✗"} ${name}: ${copied} docs, ${indexes.length} indexes${ok ? "" : ` (target has ${total})`}`);
  }

  await source.stop();
  await target.close();
  if (failed) throw new Error("Document counts did not match for some collections.");
  console.info("Done. The local copy in .data/mongo was left untouched.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
