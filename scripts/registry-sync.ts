/**
 * Run a registry sync from the command line (same engine as the dashboard / scheduler).
 *   npm run registry:sync -- NO              → incremental (since last success; first run backfills)
 *   npm run registry:sync -- NO today        → today only
 *   npm run registry:sync -- NO 2026-10-02   → one registry day
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
process.env.DISABLE_AUTO_SEED = "true";
process.env.REGISTRY_SCHEDULER = "off";

async function main() {
  const [country, what] = process.argv.slice(2);
  if (!country) throw new Error("Usage: npm run registry:sync -- <COUNTRY> [today|YYYY-MM-DD]");
  const { connectToDatabase, disconnectFromDatabase } = await import("../src/lib/db/connect");
  const { ensureCountries } = await import("../src/features/countries/service");
  const { syncCountry, syncDate, syncToday } = await import("../src/features/registry/sync");
  await connectToDatabase();
  await ensureCountries();
  const opts = { trigger: "MANUAL" as const, notify: false };
  const r = what === "today" ? await syncToday(country, opts) : what ? await syncDate(country, what, opts) : await syncCountry(country, opts);
  console.info(JSON.stringify({ ...r, errors: r.errors.slice(0, 5) }, null, 2));
  await disconnectFromDatabase();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
