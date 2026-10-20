import { afterAll, beforeAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

/**
 * Every test file gets its own throw-away in-memory MongoDB, so tests never
 * touch development data and can run in any order.
 */
process.env.DEMO_MODE = "false";
process.env.DISABLE_AUTO_SEED = "true";
process.env.EMAIL_PROVIDER = "console";
process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-123456";
// fetch is mocked in tests — no real host to be polite to.
process.env.FETCH_HOST_GAP_MS = "0";

let server: MongoMemoryServer | undefined;

beforeAll(async () => {
  // A busy machine (e.g. a dev server compiling) can need more than the 10 s default to start mongod.
  server = await MongoMemoryServer.create({ instance: { launchTimeout: 90_000 } });
  process.env.MONGODB_URI = server.getUri("et-test");
  const { connectToDatabase } = await import("@/lib/db/connect");
  await connectToDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});

afterAll(async () => {
  await mongoose.disconnect();
  const g = globalThis as unknown as { __etMongo?: Record<string, unknown> };
  if (g.__etMongo) g.__etMongo = {};
  await server?.stop();
});
