/**
 * READ-ONLY analytics health check (never writes). Run against the database in .env.local:
 *   npm run analytics:diagnose
 * Reports what could make traffic "disappear": the TTL indexes MongoDB actually has (an index
 * created by an older build or by hand keeps its own expiry), the retention setting, how far back
 * raw records reach, records per day for the last 14 days, and the durable daily statistics.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
process.env.DISABLE_AUTO_SEED = "true";
process.env.REGISTRY_SCHEDULER = "off";

async function main() {
  const { connectToDatabase, disconnectFromDatabase } = await import("../src/lib/db/connect");
  const mongoose = (await import("mongoose")).default;
  await connectToDatabase();
  const db = mongoose.connection.db!;
  const out: Record<string, unknown> = { database: db.databaseName };
  for (const name of ["webvisitors", "websessions", "webpageviews", "webanalyticsdailies", "webconversions"]) {
    const exists = (await db.listCollections({ name }).toArray()).length > 0;
    if (!exists) {
      out[name] = "missing";
      continue;
    }
    const c = db.collection(name);
    const indexes = await c.indexes();
    const ttl = indexes.filter((i) => i.expireAfterSeconds !== undefined).map((i) => ({ name: i.name, key: i.key, expireAfterSeconds: i.expireAfterSeconds }));
    const field = name === "webpageviews" ? "at" : name === "websessions" ? "startedAt" : name === "webvisitors" ? "firstSeen" : name === "webconversions" ? "at" : "computedAt";
    const [oldest, newest] = await Promise.all([c.find().sort({ [field]: 1 }).limit(1).project({ [field]: 1, expireAt: 1 }).toArray(), c.find().sort({ [field]: -1 }).limit(1).project({ [field]: 1, expireAt: 1 }).toArray()]);
    out[name] = { count: await c.estimatedDocumentCount(), ttlIndexes: ttl, oldest: oldest[0] ?? null, newest: newest[0] ?? null };
  }
  const since = new Date(Date.now() - 14 * 86_400_000);
  out.pageViewsPerDay = await db.collection("webpageviews").aggregate([
    { $match: { at: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$at", timezone: "Europe/Oslo" } }, views: { $sum: 1 }, consented: { $sum: { $cond: ["$consented", 1, 0] } }, minExpireAt: { $min: "$expireAt" } } },
    { $sort: { _id: 1 } },
  ]).toArray();
  out.retentionSetting = (await db.collection("systemsettings").findOne({ key: "analytics" }))?.value ?? "default (395 days)";
  out.env = { MONGODB_URI: process.env.MONGODB_URI ? "set" : "NOT SET (local/ephemeral database!)", ALLOW_LOCAL_DB: process.env.ALLOW_LOCAL_DB ?? "unset", ANALYTICS_SECRET: process.env.ANALYTICS_SECRET ? "set" : "unset (uses AUTH_SECRET)" };
  console.info(JSON.stringify(out, null, 2));
  console.info("\nWhat to look for:\n - a TTL index with expireAfterSeconds > 0 on at/startedAt/lastSeen (deletes N seconds after the visit) instead of { expireAt: 1 } with 0\n - minExpireAt only a day or two after the day itself (records written with a very short retention)\n - MONGODB_URI not set in production (data lives on a disk that is reset on redeploy)\n - page views per day dropping to zero for older days while newer days have data");
  await disconnectFromDatabase();
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
