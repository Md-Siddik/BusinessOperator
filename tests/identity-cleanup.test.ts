import { afterAll, expect, it } from "vitest";
import mongoose from "mongoose";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSourceBackup, verifySourceBackup } from "../scripts/lib/source-backup";
import { fingerprint } from "../scripts/lib/selective-migration";
import { executeIdentityCleanup, type CleanupScope } from "../scripts/lib/identity-cleanup";

const directories: string[] = [];
afterAll(async () => { for (const directory of directories) await rm(directory, { recursive: true, force: true }); });

it("refuses identity deletion and stale recovery metadata, then clears business data without changing identities or indexes", async () => {
  const client = mongoose.connection.getClient();
  const db = client.db(`cleanup-${new mongoose.Types.ObjectId()}`);
  const sample = client.db("sample_mflix");
  await db.collection("users").insertOne({ email: "fixture@example.test", passwordHash: "retained-test-hash", role: "OWNER", permissions: ["registry.sync"] });
  await db.collection("organizations").insertOne({ name: "Retained client profile" });
  await db.collection("countries").insertOne({ code: "NO", providerId: "brreg", enabled: true });
  await db.collection("companies").insertOne({ companyName: "Disposable source fixture" });
  await db.collection("companies").createIndex({ companyName: 1 });
  await sample.collection("users").insertOne({ name: "Disposable sample identity" });
  const directory = await mkdtemp(path.join(os.tmpdir(), "identity-cleanup-")); directories.push(directory);
  const manifest = await verifySourceBackup(db, await createSourceBackup(db, directory, true));
  const snapshot = async (name: string) => ({ collection: name, ...await fingerprint(db, name) });
  const scope: CleanupScope = {
    database: db.databaseName,
    preserved: await Promise.all(["users", "organizations", "countries"].map(snapshot)),
    emptyCollections: [await snapshot("companies")],
    sampleCollections: [{ collection: "users", ...await fingerprint(sample, "users") }],
  };
  const before = await fingerprint(db, "users");
  const progress = async () => {};
  const unsafe = { ...scope, emptyCollections: [...scope.emptyCollections, scope.preserved[0]] };
  await expect(executeIdentityCleanup(db, sample, unsafe, manifest, directory, progress)).rejects.toThrow("Unsafe collection scope");
  const broken = { ...manifest, collections: manifest.collections.map(entry => entry.name === "companies" ? { ...entry, sha256: "invalid" } : entry) };
  await expect(executeIdentityCleanup(db, sample, scope, broken, directory, progress)).rejects.toThrow("Backup snapshot mismatch");
  expect(await db.collection("companies").countDocuments()).toBe(1);
  await db.collection("companies").insertOne({ companyName: "New data after verification" });
  await expect(executeIdentityCleanup(db, sample, scope, manifest, directory, progress)).rejects.toThrow("source changed");
  expect(await fingerprint(db, "users")).toEqual(before);
  // A new, complete backup is required after the intentional isolated fixture change.
  const refreshedDir = await mkdtemp(path.join(os.tmpdir(), "identity-cleanup-new-")); directories.push(refreshedDir);
  const refreshed = await verifySourceBackup(db, await createSourceBackup(db, refreshedDir, true));
  scope.emptyCollections = [await snapshot("companies")];
  await executeIdentityCleanup(db, sample, scope, refreshed, refreshedDir, progress);
  expect(await fingerprint(db, "users")).toEqual(before);
  expect(await db.collection("organizations").countDocuments()).toBe(1);
  expect(await db.collection("countries").countDocuments()).toBe(1);
  expect(await db.collection("companies").countDocuments()).toBe(0);
  expect((await db.collection("companies").listIndexes().toArray()).some(index => index.name === "companyName_1")).toBe(true);
  expect(await sample.listCollections().toArray()).toEqual([]);
});
