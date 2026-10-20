import "server-only";
import { Readable } from "node:stream";
import { createInflateRaw } from "node:zlib";
import type { HttpClient } from "./http";
import { ProviderHttpError } from "./http";

/**
 * Helpers for official open-data files that are published as one daily bulk file
 * (no query API): stream the file, keep only the rows a provider needs, and reuse
 * the parsed result until the publisher's ETag / Last-Modified changes, so the file
 * is downloaded about once per publication, not once per sync.
 */

/** Split a byte stream into text lines (UTF-8, BOM removed, \r\n or \n). */
export async function* lines(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8");
  let rest = "";
  let first = true;
  for await (const chunk of chunks) {
    rest += decoder.decode(chunk, { stream: true });
    if (first && rest.length) {
      if (rest.charCodeAt(0) === 0xfeff) rest = rest.slice(1);
      first = false;
    }
    let i: number;
    while ((i = rest.indexOf("\n")) >= 0) {
      yield rest.slice(0, i).replace(/\r$/, "");
      rest = rest.slice(i + 1);
    }
  }
  rest += decoder.decode();
  if (rest) yield rest.replace(/\r$/, "");
}

/**
 * Parse delimiter-separated lines (RFC 4180 quoting: "a ""b"" c"). A quoted field may
 * span lines; such records are joined before they are yielded.
 */
export async function* csvRecords(input: AsyncIterable<string>, delimiter = ";"): AsyncGenerator<string[]> {
  let pending = "";
  for await (const line of input) {
    pending = pending ? `${pending}\n${line}` : line;
    // An odd number of quotes means a quoted field continues on the next line.
    if ((pending.match(/"/g)?.length ?? 0) % 2 === 1) continue;
    yield splitCsv(pending, delimiter);
    pending = "";
  }
  if (pending) yield splitCsv(pending, delimiter);
}

export function splitCsv(line: string, delimiter = ";"): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out;
}

/** Records as objects keyed by the header row. */
export async function* csvObjects(input: AsyncIterable<string>, delimiter = ";"): AsyncGenerator<Record<string, string>> {
  let header: string[] | null = null;
  for await (const rec of csvRecords(input, delimiter)) {
    if (!header) {
      header = rec.map((h) => h.trim());
      continue;
    }
    if (rec.length === 1 && rec[0] === "") continue;
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = rec[i] ?? ""));
    yield row;
  }
}

/**
 * The single file inside a ZIP archive, as a decompressed byte stream. Reads the central
 * directory (sizes are not always in the local header), supports "stored" and "deflate".
 */
export function unzipSingleEntry(zip: Buffer, match?: (name: string) => boolean): { name: string; stream: AsyncIterable<Uint8Array> } {
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ProviderHttpError("The downloaded file is not a valid ZIP archive.");
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) break;
    const method = zip.readUInt16LE(p + 10);
    const compressed = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/") || (match && !match(name))) continue;
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new ProviderHttpError("Corrupt ZIP archive (local header).");
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + compressed);
    if (method === 0) return { name, stream: Readable.from([data]) };
    if (method === 8) return { name, stream: Readable.from([data]).pipe(createInflateRaw()) };
    throw new ProviderHttpError(`Unsupported ZIP compression method ${method}.`);
  }
  throw new ProviderHttpError("The ZIP archive does not contain the expected file.");
}

/** Response body as an async byte stream (Node web streams are async-iterable). */
export function bodyStream(res: Response): AsyncIterable<Uint8Array> {
  if (!res.body) throw new ProviderHttpError("The source returned an empty response.");
  return res.body as unknown as AsyncIterable<Uint8Array>;
}

/** Version of a published file: ETag, else Last-Modified (both from a HEAD request). */
export async function fileVersion(http: HttpClient, url: string, signal?: AbortSignal): Promise<{ version: string | null; lastModified: Date | null }> {
  const res = await http.request(url, { method: "HEAD", signal, headers: { Accept: "*/*" } });
  await res.body?.cancel().catch(() => undefined);
  if (!res.ok) throw new ProviderHttpError(`${http.name} responded ${res.status} for the open-data file`, res.status);
  const lm = res.headers.get("last-modified");
  const lastModified = lm ? new Date(lm) : null;
  return { version: res.headers.get("etag") ?? lm, lastModified: lastModified && !Number.isNaN(lastModified.getTime()) ? lastModified : null };
}

type CacheEntry<T> = { version: string; since: string; rows: T[]; lastModified: Date | null };
const g = globalThis as unknown as { __etBulkCache?: Map<string, CacheEntry<unknown>>; __etBulkInflight?: Map<string, Promise<CacheEntry<unknown>>> };
const cache = (g.__etBulkCache ??= new Map());
const inflight = (g.__etBulkInflight ??= new Map());

/**
 * Rows of a bulk file kept for days ≥ `since` (ISO day). Re-downloads only when the
 * publisher's version changes, or when an older window than the cached one is asked for.
 * Concurrent callers share one download.
 */
export async function cachedRows<T>(key: string, opts: { http: HttpClient; url: string; since: string; signal?: AbortSignal; parse: (res: Response, since: string) => Promise<T[]> }): Promise<{ rows: T[]; lastModified: Date | null }> {
  const { version, lastModified } = await fileVersion(opts.http, opts.url, opts.signal);
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && version && hit.version === version && hit.since <= opts.since) return { rows: hit.rows, lastModified: hit.lastModified };

  const flightKey = `${key}|${version}|${opts.since}`;
  let p = inflight.get(flightKey) as Promise<CacheEntry<T>> | undefined;
  if (!p) {
    p = (async () => {
      const res = await opts.http.request(opts.url, { signal: opts.signal, headers: { Accept: "*/*" } });
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new ProviderHttpError(`${opts.http.name} responded ${res.status} for the open-data file`, res.status);
      }
      const rows = await opts.parse(res, opts.since);
      const entry: CacheEntry<T> = { version: version ?? `${Date.now()}`, since: opts.since, rows, lastModified };
      if (version) cache.set(key, entry as CacheEntry<unknown>);
      return entry;
    })().finally(() => inflight.delete(flightKey));
    inflight.set(flightKey, p as Promise<CacheEntry<unknown>>);
  }
  const entry = await p;
  return { rows: entry.rows, lastModified: entry.lastModified };
}

/** Test hook: forget cached files. */
export function clearBulkCache() {
  cache.clear();
  inflight.clear();
}
