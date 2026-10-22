import fs from "node:fs";
import path from "node:path";
import { isIP } from "node:net";
import { open, type CityResponse, type Reader } from "maxmind";

/**
 * Coarse visitor location (country, region, city) for website analytics.
 *
 * Sources, in order:
 *  1. Location headers set by the hosting platform (Vercel, Cloudflare), when present.
 *  2. A local, offline GeoIP database (MaxMind/DB-IP .mmdb format) at GEOIP_DB_PATH,
 *     default `.data/geoip/dbip-city-lite.mmdb` (`npm run geoip:update` downloads it).
 *
 * The IP address is only used in memory for this lookup — it is never stored, logged or
 * sent to any third party. Without a source the location is simply unknown.
 */

export type Geo = { country?: string; region?: string; city?: string };

// A runtime data file, not part of the build: keep the bundler from tracing the project for it.
const DEFAULT_DB = path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "geoip", "dbip-city-lite.mmdb");

const g = globalThis as unknown as { __etGeoReader?: Promise<Reader<CityResponse> | null> };

function reader() {
  g.__etGeoReader ??= (async () => {
    const file = process.env.GEOIP_DB_PATH || DEFAULT_DB;
    if (!fs.existsSync(/* turbopackIgnore: true */ file)) return null;
    try {
      return await open<CityResponse>(/* turbopackIgnore: true */ file);
    } catch (err) {
      console.error("[geo] could not open the GeoIP database", err);
      return null;
    }
  })();
  return g.__etGeoReader;
}

/** For tests and after `geoip:update`: forget the cached database. */
export function resetGeoReader() {
  g.__etGeoReader = undefined;
}

const clean = (v: string | null | undefined, max = 80) => {
  if (!v) return undefined;
  let s = v;
  try {
    s = decodeURIComponent(v);
  } catch {
    /* keep as is */
  }
  s = s.replace(/[\u0000-\u001f<>]/g, "").trim();
  return s ? s.slice(0, max) : undefined;
};
const countryCode = (v: string | null | undefined) => {
  const c = (v ?? "").trim().toUpperCase();
  // "XX" / "T1" are Cloudflare's unknown / Tor markers.
  return /^[A-Z]{2}$/.test(c) && c !== "XX" ? c : undefined;
};

/** Location headers from the hosting platform. */
export function geoFromHeaders(headers: Headers): Geo | null {
  const vercel = countryCode(headers.get("x-vercel-ip-country"));
  if (vercel) return { country: vercel, region: clean(headers.get("x-vercel-ip-country-region")), city: clean(headers.get("x-vercel-ip-city")) };
  const cf = countryCode(headers.get("cf-ipcountry"));
  if (cf) return { country: cf, region: clean(headers.get("cf-region")), city: clean(headers.get("cf-ipcity")) };
  return null;
}

/** Private, loopback and unparsable addresses have no location. */
function publicIp(ip: string | null | undefined) {
  const a = (ip ?? "").trim().replace(/^::ffff:/, "");
  if (!isIP(a)) return null;
  if (/^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(a) || a === "::1" || /^f[cd]|^fe80/i.test(a)) return null;
  return a;
}

export async function lookupGeo(headers: Headers, ip: string | null | undefined): Promise<Geo | null> {
  const fromHost = geoFromHeaders(headers);
  if (fromHost) return fromHost;
  const address = publicIp(ip);
  if (!address) return null;
  const db = await reader();
  if (!db) return null;
  try {
    const r = db.get(address);
    const country = countryCode(r?.country?.iso_code ?? r?.registered_country?.iso_code);
    if (!country) return null;
    return { country, region: clean(r?.subdivisions?.[0]?.names?.en), city: clean(r?.city?.names?.en) };
  } catch {
    return null;
  }
}

/** A browser time zone from the tracker, accepted only when it is a real IANA zone. */
export function validTimeZone(tz: unknown): string | undefined {
  if (typeof tz !== "string" || tz.length > 64 || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) return undefined;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}
