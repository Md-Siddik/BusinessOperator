/** Real provider + application ingestion, with auto-indexing/seed/workers disabled. No durable writes. */
import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { writeFile } from "node:fs/promises";
import { configureMongoDns } from "../src/lib/db/configuration";
loadEnvConfig(process.cwd());
process.env.DISABLE_AUTO_SEED = "true";
process.env.REGISTRY_SCHEDULER = "off";
let stage = "configuration";
async function main() {
  configureMongoDns();
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required.");
  mongoose.set("autoCreate", false); mongoose.set("autoIndex", false);
  stage = "connect";
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 12000 });
  try {
    const db = mongoose.connection.db!;
    stage = "fingerprint_before";
    const { fingerprint } = await import("./lib/selective-migration");
    const protectedBefore = { users: await fingerprint(db, "users"), assignments: await fingerprint(db, "leadassignments") };
    const counts = async () => Object.fromEntries(await Promise.all(["companies", "contacts", "jobs", "established_companies"].map(async name => [name, await db.collection(name).countDocuments()])));
    const before = await counts();
    stage = "import_ingestion";
    const { getRegistryProvider } = await import("../src/features/registry/providers");
    const { ingestCompanies } = await import("../src/features/registry/sync");
    const { clearTransientRegistry, transientRows } = await import("../src/lib/db/transient-registry");
    const { todayIn, addDays } = await import("../src/lib/dates/country-time");
    const provider = getRegistryProvider("brreg")!;
    const day = addDays(todayIn("Europe/Oslo"), -1);
    stage = "fetch_registry";
    const result = await provider.getRegistrations!(day, day, { limit: 2, signal: AbortSignal.timeout(60000) });
    if (!result.companies.length) throw new Error("Source returned no rows; ingestion cannot be verified with an empty fixture.");
    stage = "ingest";
    await ingestCompanies(provider, "NO", result.companies);
    const after = await counts();
    stage = "fingerprint_after";
    const protectedAfter = { users: await fingerprint(db, "users"), assignments: await fingerprint(db, "leadassignments") };
    const report = { checkedAt: new Date().toISOString(), database: db.databaseName, source: provider.id, day, liveRowsFetched: result.companies.length, temporaryCompanyRows: transientRows("companies").length, before, after, durableDatasetCountsUnchanged: JSON.stringify(before) === JSON.stringify(after), usersAndAssignmentsUnchanged: JSON.stringify(protectedBefore) === JSON.stringify(protectedAfter), writesEnabled: false };
    clearTransientRegistry();
    await writeFile("storage/backups/storage-audit/live-fetch-verification.json", JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(report, null, 2));
    if (!report.durableDatasetCountsUnchanged || !report.usersAndAssignmentsUnchanged) throw new Error("Database changed during verification; investigate concurrent writers.");
  } finally { await mongoose.disconnect(); }
}
main().catch(error => {
  const controlled = ["Source returned no rows; ingestion cannot be verified with an empty fixture.", "Database changed during verification; investigate concurrent writers."];
  console.error("Live storage verification failed:", { stage, errorCode: typeof error.code === "number" ? error.code : undefined, errorType: error.name, reason: controlled.includes(error.message) ? error.message : /cannot be imported from a Client Component/.test(error.message) ? "SERVER_ONLY_CONDITION_REQUIRED" : "REDACTED" });
  process.exitCode = 1;
});
