/**
 * Seed demo data.
 *   npm run seed        → seeds an empty database
 *   npm run seed:reset  → wipes ALL collections, then seeds
 *
 * Uses MONGODB_URI when set; otherwise the local development database
 * (shared with `npm run dev` if it is running).
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
process.env.DISABLE_AUTO_SEED = "true";

async function main() {
  const reset = process.argv.includes("--reset");
  const { connectToDatabase, disconnectFromDatabase } = await import("../src/lib/db/connect");
  const { autoSeedIfEmpty, seedDatabase } = await import("../src/lib/seed");
  await connectToDatabase();
  if (reset) {
    console.info("Resetting database and seeding demo data…");
    await seedDatabase({ reset: true, log: (m) => console.info(m) });
  } else {
    const seeded = await autoSeedIfEmpty((m) => console.info(m));
    if (!seeded) console.info("Database already contains users — nothing to do. Use `npm run seed:reset` to start over.");
  }
  await disconnectFromDatabase();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
