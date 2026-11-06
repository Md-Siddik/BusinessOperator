import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareDailyDeletion, advanceDailyDeletion, type DailyScope } from "@/features/daily-records/deletion";
import { Company, Opportunity, SystemSetting, User, DailyRegistrationSnapshot } from "@/models";
import type { Actor } from "@/lib/permissions";
import { POST, PATCH } from "@/app/api/daily-records/deletion/route";
import { NextRequest } from "next/server";
const session = vi.hoisted(() => ({ user: null as null | { actor: Actor; status: string; role: string; emailVerifiedAt: Date } }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => session.user }));

const owner: Actor = { id: new mongoose.Types.ObjectId().toString(), role: "OWNER", permissions: [], name: "Test Owner", email: "owner@example.test" };
const scope: DailyScope = { category: "company", day: "2026-11-06", filters: { country: "NO", range: "custom", from: "2026-11-06", to: "2026-11-06" } };
let root: string;
beforeEach(async () => {
  await Promise.all([Company.deleteMany({}), Opportunity.deleteMany({}), SystemSetting.deleteMany({}), User.deleteMany({}), DailyRegistrationSnapshot.deleteMany({})]);
  root = await mkdtemp(path.join(os.tmpdir(), "daily-delete-"));
  process.env.DAILY_BACKUP_DIR = root;
  session.user = null;
});
const roots: string[] = [];
afterAll(async () => { for (const dir of roots) await rm(dir, { recursive: true, force: true }); delete process.env.DAILY_BACKUP_DIR; });
async function seedCompany(day = scope.day, country = "NO") {
  return Company.collection.insertOne({ countryCode: country, registrationDay: day, companyName: "Synthetic Company", source: "test", sourceId: new mongoose.Types.ObjectId().toString(), isDemo: false });
}
async function prepare(s = scope) { roots.push(root); return prepareDailyDeletion(owner, s); }
async function confirm(token: string, day = scope.day) {
  await advanceDailyDeletion(owner, { token, action: "continue" });
  await advanceDailyDeletion(owner, { token, action: "acknowledge", acknowledged: true });
  return advanceDailyDeletion(owner, { token, action: "delete", confirmation: `DELETE ${day}` });
}
describe("daily deletion with verified backup", () => {
  it("requires all three steps, exact text, and preserves unrelated dates/countries/users", async () => {
    await seedCompany(); await seedCompany("2026-11-05"); await seedCompany(scope.day, "SE");
    await DailyRegistrationSnapshot.create({ countryCode: "NO", date: scope.day, newCompanies: 1, sourceTotal: 1, isDemo: false });
    await User.collection.insertOne({ email: "preserved@example.test", passwordHash: "unchanged" });
    const ticket = await prepare();
    expect(ticket.count).toBe(1);
    await expect(advanceDailyDeletion(owner, { token: ticket.token, action: "delete", confirmation: `DELETE ${scope.day}` })).rejects.toThrow("in order");
    await advanceDailyDeletion(owner, { token: ticket.token, action: "continue" });
    await expect(advanceDailyDeletion(owner, { token: ticket.token, action: "acknowledge", acknowledged: false })).rejects.toThrow("acknowledgement");
    await advanceDailyDeletion(owner, { token: ticket.token, action: "acknowledge", acknowledged: true });
    await expect(advanceDailyDeletion(owner, { token: ticket.token, action: "delete", confirmation: "DELETE 2026-11-05" })).rejects.toThrow("does not match");
    const result = await advanceDailyDeletion(owner, { token: ticket.token, action: "delete", confirmation: `DELETE ${scope.day}` });
    expect(result).toMatchObject({ deleted: 1 });
    expect(await Company.countDocuments()).toBe(2);
    expect(await User.countDocuments()).toBe(1);
    expect(await DailyRegistrationSnapshot.findOne({ countryCode: "NO", date: scope.day }).lean()).toMatchObject({ newCompanies: 0, sourceTotal: 1 });
    expect(await advanceDailyDeletion(owner, { token: ticket.token, action: "delete", confirmation: `DELETE ${scope.day}` })).toMatchObject({ deleted: 1 });
    const backup = JSON.parse(await readFile(path.join(root, (await readdir(root))[0]), "utf8"));
    expect(mongoose.mongo.BSON.deserialize(Buffer.from(backup.documents[0], "base64")).companyName).toBe("Synthetic Company");
  });
  it("deletes only the selected hiring day in the country's time zone", async () => {
    const base = { providerId: "test", isCanonical: true, activity: "ACTIVE", countryCode: "NO", archivedAt: null };
    await Opportunity.collection.insertMany([
      { ...base, externalId: "inside", type: "HIRING", firstSeenAt: new Date("2026-11-05T23:00:00Z") },
      { ...base, externalId: "before", type: "HIRING", firstSeenAt: new Date("2026-11-05T22:59:59Z") },
      { ...base, externalId: "after", type: "HIRING", firstSeenAt: new Date("2026-11-06T23:00:00Z") },
      { ...base, externalId: "other-type", type: "PROCUREMENT", firstSeenAt: new Date("2026-11-06T12:00:00Z") },
    ]);
    const ticket = await prepare({ category: "job", day: scope.day, filters: { type: "HIRING", country: "NO", preset: "custom", from: scope.day, to: scope.day, dateField: "discovered" } });
    expect(ticket.count).toBe(1);
    expect(await confirm(ticket.token)).toMatchObject({ deleted: 1 });
    expect(await Opportunity.countDocuments()).toBe(3);
  });
  it("refuses changed counts, same-count replacements and modified record values", async () => {
    await seedCompany();
    const first = await prepare(); await seedCompany();
    await expect(confirm(first.token)).rejects.toThrow("changed");
    const second = await prepare();
    await Company.collection.updateOne({}, { $set: { companyName: "Changed" } });
    await expect(confirm(second.token)).rejects.toThrow("changed");
    expect(await Company.countDocuments()).toBe(2);
  });
  it("requires an intact backup and denies another actor or non-owner", async () => {
    await seedCompany(); const ticket = await prepare();
    await expect(advanceDailyDeletion({ ...owner, id: new mongoose.Types.ObjectId().toString() }, { token: ticket.token, action: "continue" })).rejects.toThrow("expired");
    await expect(prepareDailyDeletion({ ...owner, role: "ADMIN" }, scope)).rejects.toThrow("permission");
    await writeFile(path.join(root, (await readdir(root))[0]), "corrupt");
    await expect(confirm(ticket.token)).rejects.toThrow("integrity");
    expect(await Company.countDocuments()).toBe(1);
  });
  it("handles concurrent final submissions without double deletion", async () => {
    await seedCompany(); const ticket = await prepare();
    await advanceDailyDeletion(owner, { token: ticket.token, action: "continue" });
    await advanceDailyDeletion(owner, { token: ticket.token, action: "acknowledge", acknowledged: true });
    const results = await Promise.all([
      advanceDailyDeletion(owner, { token: ticket.token, action: "delete", confirmation: `DELETE ${scope.day}` }),
      advanceDailyDeletion(owner, { token: ticket.token, action: "delete", confirmation: `DELETE ${scope.day}` }),
    ]);
    expect(results.every(result => result.deleted === 1)).toBe(true);
    expect(await Company.countDocuments()).toBe(0);
  });
  it("invalidates changed confirmations even if the original count is later restored", async () => {
    const original = await seedCompany(); const ticket = await prepare();
    const added = await seedCompany();
    await expect(advanceDailyDeletion(owner, { token: ticket.token, action: "continue" })).rejects.toThrow("changed");
    await Company.collection.deleteOne({ _id: added.insertedId });
    await expect(advanceDailyDeletion(owner, { token: ticket.token, action: "continue" })).rejects.toThrow("in order");
    expect(await Company.collection.findOne({ _id: original.insertedId })).not.toBeNull();
  });
  it("refuses same-count replacements after the last confirmation", async () => {
    const original = await seedCompany(); const ticket = await prepare();
    await advanceDailyDeletion(owner, { token: ticket.token, action: "continue" });
    await advanceDailyDeletion(owner, { token: ticket.token, action: "acknowledge", acknowledged: true });
    await Company.collection.deleteOne({ _id: original.insertedId }); await seedCompany();
    await expect(advanceDailyDeletion(owner, { token: ticket.token, action: "delete", confirmation: `DELETE ${scope.day}` })).rejects.toThrow("changed");
    expect(await Company.countDocuments()).toBe(1);
  });
  it("rejects invalid/widened scopes and missing durable backup configuration", async () => {
    await expect(prepareDailyDeletion(owner, { ...scope, all: true })).rejects.toThrow();
    await expect(prepareDailyDeletion(owner, { ...scope, filters: { ...scope.filters, range: "all" } })).rejects.toThrow();
    delete process.env.DAILY_BACKUP_DIR;
    await expect(prepareDailyDeletion(owner, scope)).rejects.toThrow("DAILY_BACKUP_DIR");
  });
  it("blocks unauthenticated API preparation and deletion", async () => {
    for (const [method, handler] of [["POST", POST], ["PATCH", PATCH]] as const) {
      const response = await handler(new NextRequest("http://localhost/api/daily-records/deletion", { method, body: "{}", headers: { "content-type": "application/json" } }), { params: Promise.resolve({}) });
      expect(response.status).toBe(401);
    }
  });
  it("blocks non-owner API access on both endpoints", async () => {
    session.user = { actor: { ...owner, role: "ADMIN" }, status: "ACTIVE", role: "ADMIN", emailVerifiedAt: new Date() };
    for (const [method, handler] of [["POST", POST], ["PATCH", PATCH]] as const) {
      const response = await handler(new NextRequest("http://localhost/api/daily-records/deletion", { method, body: "{}", headers: { "content-type": "application/json" } }), { params: Promise.resolve({}) });
      expect(response.status).toBe(403);
    }
  });
});
