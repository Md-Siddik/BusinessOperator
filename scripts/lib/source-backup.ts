import mongoose from "mongoose";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";
import path from "node:path";
import { KEEP, canonical, fingerprint } from "./selective-migration";

type Db = mongoose.mongo.Db;
type Entry = { name: string; file: string; count: number; sha256: string; options: unknown; indexes: unknown[] };
export type BackupManifest = { version: number; database: string; createdAt: string; verified: boolean; collections: Entry[] };

export async function* readBackupDocuments(file: string) {
  const input = createReadStream(file);
  const stream = createGunzip();
  input.on("error", error => stream.destroy(error));
  const completion = pipeline(input, stream);
  // The readable side is consumed below; attach a rejection handler immediately.
  void completion.catch(() => undefined);
  let pending = Buffer.alloc(0);
  for await (const chunk of stream) {
    pending = Buffer.concat([pending, chunk as Buffer]);
    while (pending.length >= 4) {
      const size = pending.readInt32LE();
      if (size < 5 || size > 16 * 1024 * 1024) throw new Error("Invalid BSON backup document size.");
      if (pending.length < size) break;
      yield mongoose.mongo.BSON.deserialize(pending.subarray(0, size), { promoteValues: false });
      pending = pending.subarray(size);
    }
  }
  if (pending.length) throw new Error("Truncated BSON backup.");
  await completion;
}

async function archiveFingerprint(file: string) {
  const hash = createHash("sha256"); let count = 0;
  for await (const doc of readBackupDocuments(file)) { hash.update(canonical(doc)); count++; }
  return { count, sha256: hash.digest("hex") };
}

export async function createSourceBackup(source: Db, directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const manifest: BackupManifest = { version: 1, database: source.databaseName, createdAt: new Date().toISOString(), verified: false, collections: [] };
  for (const info of await source.listCollections({ type: "collection" }).toArray()) {
    if (!KEEP.has(info.name)) continue;
    const hash = createHash("sha256"); let count = 0;
    const file = `${String(manifest.collections.length).padStart(4, "0")}.bson.gz`;
    async function* documents() {
      for await (const doc of source.collection(info.name).find({}, { promoteValues: false }).sort({ _id: 1 })) {
        hash.update(canonical(doc)); count++;
        yield mongoose.mongo.BSON.serialize(doc);
      }
    }
    await pipeline(Readable.from(documents()), createGzip(), createWriteStream(path.join(directory, file), { flags: "wx", mode: 0o600 }));
    const sha256 = hash.digest("hex");
    const restored = await archiveFingerprint(path.join(directory, file));
    if (restored.count !== count || restored.sha256 !== sha256) throw new Error("Source backup read-back integrity failed.");
    manifest.collections.push({ name: info.name, file, count, sha256, options: "options" in info ? info.options : {}, indexes: await source.collection(info.name).listIndexes().toArray() });
    console.info(JSON.stringify({ backedUp: info.name, documents: count, archiveReadBackVerified: true }));
  }
  // Confirms the complete archive still matches the live source before marking it usable.
  for (const entry of manifest.collections) {
    const live = await fingerprint(source, entry.name);
    if (live.count !== entry.count || live.sha256 !== entry.sha256) throw new Error("Source changed during backup. Pause writers and create a fresh backup.");
  }
  manifest.verified = true;
  const file = path.join(directory, "manifest.json");
  await writeFile(file, mongoose.mongo.BSON.EJSON.stringify(manifest, { relaxed: false }), { flag: "wx", mode: 0o600 });
  return file;
}

export async function verifySourceBackup(source: Db, manifestFile: string) {
  const manifest = mongoose.mongo.BSON.EJSON.parse(await readFile(manifestFile, "utf8")) as BackupManifest;
  if (manifest.version !== 1 || !manifest.verified || manifest.database !== source.databaseName) throw new Error("Source backup manifest is invalid or for another database.");
  const expected = (await source.listCollections({ type: "collection" }).toArray()).filter(info => KEEP.has(info.name)).map(info => info.name).sort();
  if (JSON.stringify(expected) !== JSON.stringify(manifest.collections.map(entry => entry.name).sort())) throw new Error("Source backup does not cover all retained collections.");
  for (const entry of manifest.collections) {
    if (!/^\d{4}\.bson\.gz$/.test(entry.file)) throw new Error("Invalid source backup filename.");
    const archive = await archiveFingerprint(path.join(path.dirname(manifestFile), entry.file));
    const live = await fingerprint(source, entry.name);
    if (archive.count !== entry.count || archive.sha256 !== entry.sha256 || live.count !== entry.count || live.sha256 !== entry.sha256) throw new Error("Source backup or live source changed. Create and verify a fresh backup.");
  }
  return manifest;
}
