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

let server: MongoMemoryServer | undefined;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
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
