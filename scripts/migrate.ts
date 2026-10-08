/** Run pending, idempotent schema migrations (they also run automatically in the scheduler). */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
process.env.DISABLE_AUTO_SEED = "true";
process.env.REGISTRY_SCHEDULER = "off";

async function main() {
  const { connectToDatabase, disconnectFromDatabase } = await import("../src/lib/db/connect");
  const { runMigrations } = await import("../src/lib/migrations");
  await connectToDatabase();
  console.info("done:", await runMigrations());
  await disconnectFromDatabase();
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
