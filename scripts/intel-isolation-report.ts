/**
 * Read-only isolation report for Startup Company Intelligence vs Old company Intelligence
 * (aggregation only — nothing is written).
 *   npm run intel:isolation
 * Prints the records in each module, the cross-module duplicate count (must be 0) and how many
 * startup records were added by the earlier established-company job (they stay in Startup
 * Company Intelligence untouched and are excluded from Old company Intelligence).
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
process.env.DISABLE_AUTO_SEED = "true";
process.env.REGISTRY_SCHEDULER = "off";

async function main() {
  const { connectToDatabase, disconnectFromDatabase } = await import("../src/lib/db/connect");
  const { EstablishedCompany } = await import("../src/models");
  const { isolationReport } = await import("../src/features/established/service");
  await connectToDatabase();
  const r = await isolationReport();
  const byCountry = await EstablishedCompany.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$countryCode", n: { $sum: 1 } } }, { $sort: { n: -1 } }]);
  console.info(`Startup Company Intelligence (Company, non-demo):     ${r.startup}`);
  console.info(`  of which added by the earlier established job:      ${r.startupFromEstablishedJob}`);
  console.info(`Old company Intelligence (EstablishedCompany):        ${r.old}`);
  for (const c of byCountry) console.info(`  ${c._id}: ${c.n}`);
  console.info(`Cross-module duplicates (same country + reg. number): ${r.overlap}${r.overlap ? "  ← run the scheduler sweep (sweepStartupOverlap)" : ""}`);
  await disconnectFromDatabase();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
