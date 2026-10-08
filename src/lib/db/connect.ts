import mongoose from "mongoose";
import path from "node:path";
import fs from "node:fs";

/**
 * MongoDB connection.
 *
 * - MONGODB_URI set → connect to it (production, staging, local MongoDB).
 * - MONGODB_URI unset in development → start (or reuse) a persistent local
 *   mongod via mongodb-memory-server, stored in .data/mongo. This keeps the
 *   project runnable with zero infrastructure.
 * - With SEED_DEV_ACCOUNTS=true (or DEMO_MODE=true) and an empty database, development
 *   accounts and a sample client workspace are seeded once. Companies are only
 *   generated in demo mode — real data comes from the registry scheduler.
 */
type MongoGlobal = {
  conn?: typeof mongoose;
  promise?: Promise<typeof mongoose>;
  memoryServer?: { stop: () => Promise<boolean> };
  seedPromise?: Promise<void>;
};

const g = globalThis as unknown as { __etMongo?: MongoGlobal };
const state: MongoGlobal = (g.__etMongo ??= {});

const LOCAL_DB_PORT = Number(process.env.LOCAL_DB_PORT || 27027);
const LOCAL_DB_NAME = "exploretechify";

export class DatabaseUnavailableError extends Error {
  constructor(message = "Database is not configured") {
    super(message);
    this.name = "DatabaseUnavailableError";
  }
}

export function isBuildPhase() {
  return process.env.NEXT_PHASE === "phase-production-build";
}

/** True if a database can be reached in this environment (without connecting). */
export function isDatabaseConfigured() {
  if (process.env.MONGODB_URI) return true;
  if (isBuildPhase()) return false;
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_LOCAL_DB === "true";
}

async function canConnect(uri: string) {
  const probe = mongoose.createConnection(uri, { serverSelectionTimeoutMS: 1500 });
  try {
    await probe.asPromise();
    return true;
  } catch {
    return false;
  } finally {
    await probe.close().catch(() => undefined);
  }
}

async function resolveUri(): Promise<string> {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  if (!isDatabaseConfigured()) throw new DatabaseUnavailableError("MONGODB_URI is required in production");

  const localUri = `mongodb://127.0.0.1:${LOCAL_DB_PORT}/${LOCAL_DB_NAME}`;
  // Another process (dev server / seed script) may already be running the local DB.
  if (await canConnect(localUri)) return localUri;

  const dbPath = path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "mongo");
  fs.mkdirSync(dbPath, { recursive: true });
  const { MongoMemoryServer } = await import("mongodb-memory-server");
  const server = await MongoMemoryServer.create({
    instance: { dbPath, port: LOCAL_DB_PORT, storageEngine: "wiredTiger", dbName: LOCAL_DB_NAME },
  });
  state.memoryServer = server;
  console.info(`[db] Local development MongoDB started on port ${LOCAL_DB_PORT} (data: .data/mongo)`);
  return localUri;
}

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (state.conn && mongoose.connection.readyState === 1) {
    await ensureDemoSeed();
    return state.conn;
  }
  if (!state.promise) {
    state.promise = (async () => {
      const uri = await resolveUri();
      mongoose.set("strictQuery", true);
      return mongoose.connect(uri, { maxPoolSize: 10, serverSelectionTimeoutMS: 10_000 });
    })().catch((err) => {
      state.promise = undefined;
      throw err;
    });
  }
  state.conn = await state.promise;
  await ensureDemoSeed();
  return state.conn;
}

async function ensureDemoSeed() {
  if (process.env.SEED_DEV_ACCOUNTS !== "true" && process.env.DEMO_MODE !== "true") return;
  if (process.env.DISABLE_AUTO_SEED === "true") return;
  if (!state.seedPromise) {
    state.seedPromise = (async () => {
      const { autoSeedIfEmpty } = await import("@/lib/seed");
      await autoSeedIfEmpty();
    })().catch((err) => {
      console.error("[seed] Automatic demo seed failed:", err);
    });
  }
  await state.seedPromise;
}

export async function disconnectFromDatabase() {
  await mongoose.disconnect();
  state.conn = undefined;
  state.promise = undefined;
  state.seedPromise = undefined;
  if (state.memoryServer) {
    await state.memoryServer.stop();
    state.memoryServer = undefined;
  }
}
