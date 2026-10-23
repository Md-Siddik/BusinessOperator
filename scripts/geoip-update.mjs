// Downloads the free DB-IP "IP to City Lite" database (CC BY 4.0, https://db-ip.com) used by
// Website Analytics to turn a visit into a coarse location (country, region, city).
// The lookup happens on this server; IP addresses are never stored or sent anywhere.
//
//   npm run geoip:update            → .data/geoip/dbip-city-lite.mmdb
//   GEOIP_DB_PATH=/path/file.mmdb   → a different location (also read by the app)
//
// DB-IP publishes a new file each month; re-run monthly (e.g. from cron) to stay current.
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

const target = process.env.GEOIP_DB_PATH || path.join(process.cwd(), ".data", "geoip", "dbip-city-lite.mmdb");
fs.mkdirSync(path.dirname(target), { recursive: true });

const month = (offset) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - offset);
  return d.toISOString().slice(0, 7);
};

let lastError;
// The current month's file appears early in the month; fall back to the previous one.
for (const m of [month(0), month(1)]) {
  const url = `https://download.db-ip.com/free/dbip-city-lite-${m}.mmdb.gz`;
  try {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const tmp = `${target}.download`;
    await pipeline(Readable.fromWeb(res.body), createGunzip(), fs.createWriteStream(tmp));
    // Never replace a working database with an obviously broken file.
    if (fs.statSync(tmp).size < 1_000_000) throw new Error("downloaded file is unexpectedly small");
    fs.renameSync(tmp, target);
    console.log(`GeoIP database ${m} saved to ${target} (${(fs.statSync(target).size / 1e6).toFixed(0)} MB).`);
    console.log("IP geolocation by DB-IP (https://db-ip.com), licensed under CC BY 4.0. Restart the app to load it.");
    process.exit(0);
  } catch (err) {
    lastError = err;
    console.warn(`Could not download ${url}: ${err.message}`);
  }
}
console.error(`GeoIP update failed: ${lastError?.message}. Website Analytics keeps working; locations show as unknown until a database is available.`);
process.exit(1);
