/**
 * Back up website analytics to NDJSON files (read-only on the database):
 *   npm run analytics:backup                       → storage/backups/analytics/<timestamp>/
 *   npm run analytics:backup -- --out /mnt/backups  → a directory of your choice (e.g. a mounted volume)
 * Writes the durable daily statistics and lead records (always), and — with --raw — the raw
 * visitors, sessions and page views. Contains no IP addresses. Lead records reference enquiries by
 * id only; contact details stay in the enquiries (covered by the database's own backups).
 * Schedule it daily (cron / Task Scheduler) and copy the directory off the server.
 */
import { loadEnvConfig } from "@next/env";
import fs from "node:fs";
import path from "node:path";

loadEnvConfig(process.cwd());
process.env.DISABLE_AUTO_SEED = "true";
process.env.REGISTRY_SCHEDULER = "off";

async function main() {
  const args = process.argv.slice(2);
  const outArg = args.includes("--out") ? args[args.indexOf("--out") + 1] : undefined;
  const raw = args.includes("--raw");
  const dir = path.resolve(outArg ?? path.join("storage", "backups", "analytics", new Date().toISOString().replace(/[:.]/g, "-")));
  fs.mkdirSync(dir, { recursive: true });
  const { connectToDatabase, disconnectFromDatabase } = await import("../src/lib/db/connect");
  const mongoose = (await import("mongoose")).default;
  await connectToDatabase();
  const db = mongoose.connection.db!;
  const names = ["webanalyticsdailies", "webconversions", ...(raw ? ["webvisitors", "websessions", "webpageviews"] : [])];
  const summary: Record<string, number> = {};
  for (const name of names) {
    const file = fs.createWriteStream(path.join(dir, `${name}.ndjson`));
    let n = 0;
    for await (const doc of db.collection(name).find()) {
      file.write(`${JSON.stringify(doc)}\n`);
      n++;
    }
    await new Promise((r) => file.end(r));
    summary[name] = n;
  }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ createdAt: new Date().toISOString(), database: db.databaseName, collections: summary }, null, 2));
  console.info(`analytics backup written to ${dir}`, summary);
  await disconnectFromDatabase();
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
