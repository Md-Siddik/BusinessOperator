import { beforeEach, expect, it } from "vitest";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { migrateSelected, fingerprint, inventory } from "../scripts/lib/selective-migration";

let source: mongoose.mongo.Db;
let target: mongoose.mongo.Db;
beforeEach(async () => {
  const client = mongoose.connection.getClient();
  const suffix = new mongoose.Types.ObjectId().toString();
  source = client.db(`source-${suffix}`); target = client.db(`target-${suffix}`);
});

it("preserves complete BSON, company history, users and indexes, skips jobs and safely reruns", async () => {
  const hash = await bcrypt.hash("SyntheticPassword-123!", 4);
  await source.collection("users").insertOne({ email: "preserved@example.test", passwordHash: hash, role: "OWNER", permissions: ["companies.read"], sessionVersion: 7 });
  await source.collection("users").createIndex({ email: 1 }, { unique: true });
  await source.collection("companies").insertOne({ companyName: "Company — ঢাকা", firstSeenAt: new Date("2020-01-01"), nested: { rawImportantValue: "preserved" }, registrationDay: "2020-01-01" });
  await source.collection("companies").createIndex({ companyName: "text" }, { weights: { companyName: 2 }, default_language: "none" });
  await source.collection("established_companies").insertOne({ companyName: "Historical company", phone: "+8801700000000" });
  await source.collection("opportunities").insertOne({ type: "HIRING", title: "Old job" });
  const original = await fingerprint(source, "companies");
  const first = await migrateSelected(source, target);
  expect(first.find(r => r.collection === "companies")).toMatchObject({ inserted: 1, preserved: 1, verified: true });
  expect(await fingerprint(source, "companies")).toEqual(original);
  expect(await fingerprint(target, "companies")).toEqual(original);
  expect(await target.collection("opportunities").countDocuments()).toBe(0);
  const user = await target.collection("users").findOne({});
  expect(user?.passwordHash).toBe(hash);
  expect(await bcrypt.compare("SyntheticPassword-123!", user!.passwordHash)).toBe(true);
  expect(user?.sessionVersion).toBe(7);
  expect((await target.collection("users").indexes()).find(i => i.name === "email_1")?.unique).toBe(true);
  expect((await migrateSelected(source, target)).every(r => r.inserted === 0)).toBe(true);
  const sizes = await inventory(source);
  expect(sizes.find(c => c.name === "companies")?.dataBytes).toBeGreaterThan(0);
});

it("rejects unknown collections and conflicting target records without overwriting either side", async () => {
  await source.collection("unreviewed").insertOne({ important: true });
  await expect(migrateSelected(source, target)).rejects.toThrow("Unclassified");
  expect(await target.listCollections().toArray()).toHaveLength(0);
  const other = source.client.db(`reviewed-${new mongoose.Types.ObjectId()}`);
  const id = new mongoose.Types.ObjectId();
  await other.collection("users").insertOne({ _id: id, email: "old@example.test" });
  await target.collection("users").insertOne({ _id: id, email: "new@example.test" });
  await expect(migrateSelected(other, target)).rejects.toThrow("conflict");
  expect((await target.collection("users").findOne({ _id: id }))?.email).toBe("new@example.test");
});

it("refuses a non-fresh job destination and the same source/destination", async () => {
  await source.collection("companies").insertOne({ important: true });
  await target.collection("opportunities").insertOne({ title: "Keep me" });
  await expect(migrateSelected(source, target)).rejects.toThrow("not fresh");
  expect(await target.collection("opportunities").countDocuments()).toBe(1);
  expect(await target.collection("companies").countDocuments()).toBe(0);
  await expect(migrateSelected(source, source)).rejects.toThrow("must differ");
});

it("reports isolated business-record failures and preserves every essential user", async () => {
  await source.collection("companies").insertMany([{ name: "kept" }, { name: "rejected" }]);
  await source.collection("users").insertOne({ email: "preserved@example.test", passwordHash: "unchanged" });
  await target.createCollection("companies", { validator: { name: { $ne: "rejected" } } });
  const result = await migrateSelected(source, target, { continueBusinessErrors: true });
  const companies = result.find(row => row.collection === "companies")!;
  expect(companies.preserved).toBe(1);
  expect(companies.failedRecords).toHaveLength(1);
  expect(companies.failedRecords[0].code).toBe(121);
  expect(companies.inserted).toBe(1);
  expect(await target.collection("users").countDocuments()).toBe(1);
  expect(await source.collection("companies").countDocuments()).toBe(2);
});
