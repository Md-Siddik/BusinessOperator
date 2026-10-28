/**
 * Revert migration "2026-10-marketer-table-v1": remove exactly the "View Marketer Table" grants it
 * recorded (each removal is audited) and restore the per-marketer rows it merged. Leads sent to
 * the table afterwards are not touched. Usage: npm run migrate:revert-marketer-access
 * With --admins: revert "2026-10-admin-marketer-table-v1" instead (the Admins' read-only access).
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
process.env.DISABLE_AUTO_SEED = "true";
process.env.REGISTRY_SCHEDULER = "off";

async function main() {
  const { connectToDatabase, disconnectFromDatabase } = await import("../src/lib/db/connect");
  const { revertPendingHandoffAccess, ADMIN_TABLE_MIGRATION_KEY, HANDOFF_MIGRATION_KEY } = await import("../src/features/marketer/handoff-migration");
  await connectToDatabase();
  console.info(await revertPendingHandoffAccess(process.argv.includes("--admins") ? ADMIN_TABLE_MIGRATION_KEY : HANDOFF_MIGRATION_KEY));
  await disconnectFromDatabase();
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
