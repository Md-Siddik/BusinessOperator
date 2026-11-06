import "server-only";
import mongoose, { type ClientSession } from "mongoose";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { Company, Opportunity, SystemSetting, DailyRegistrationSnapshot } from "@/models";
import { type Actor, isOwner } from "@/lib/permissions";
import { AppError, Errors } from "@/lib/errors";
import { isDay } from "@/lib/dates/country-time";
import { buildCompanyFilter, companyQuerySchema } from "@/features/companies/service";
import { buildOpportunityFilter, opportunityQuerySchema, dateWindow } from "@/features/opportunities/service";

const scopeSchema = z.object({
  category: z.enum(["company", "job"]),
  day: z.string().refine(isDay, "Select one valid calendar day"),
  filters: z.record(z.string(), z.string()),
}).strict();
export type DailyScope = z.infer<typeof scopeSchema>;
const requestSchema = z.object({ token: z.string().uuid(), action: z.enum(["continue", "acknowledge", "delete"]), acknowledged: z.boolean().optional(), confirmation: z.string().optional() }).strict();
type Ticket = { scope: DailyScope; actorId: string; count: number; digest: string; stage: number; expires: number; deleted?: number };
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const keyFor = (token: string) => `daily-delete:${hash(token)}`;

function assertOwner(actor: Actor) {
  if (!isOwner(actor)) throw Errors.forbidden();
}
function backupPath(token: string) {
  const configured = process.env.DAILY_BACKUP_DIR;
  if (!configured || !path.isAbsolute(configured)) throw Errors.badRequest("Configure an absolute durable DAILY_BACKUP_DIR before deleting daily records.");
  const root = path.resolve(configured);
  const publicDir = path.resolve(process.cwd(), "public");
  if (root === publicDir || root.startsWith(publicDir + path.sep)) throw Errors.badRequest("Backups must be stored outside the public directory.");
  return path.join(root, `${hash(token)}.json`);
}

/** Reuse the list's exact filters, including visibility, country and date basis. No client Mongo filters. */
function target(actor: Actor, scope: DailyScope) {
  if (scope.category === "company") {
    const q = companyQuerySchema.strict().parse(scope.filters);
    if (q.range !== "custom" || q.from !== scope.day || q.to !== scope.day) throw Errors.badRequest("Deletion requires one exact selected day.");
    return { collection: Company.collection.name, filter: buildCompanyFilter(actor, q) };
  }
  const q = opportunityQuerySchema.strict().parse(scope.filters);
  if (q.type !== "HIRING" || q.preset !== "custom" || q.from !== scope.day || q.to !== scope.day || !dateWindow(q)) throw Errors.badRequest("Select one exact day of Job Intelligence records.");
  return { collection: Opportunity.collection.name, filter: buildOpportunityFilter(q) };
}

async function snapshot(actor: Actor, scope: DailyScope, session?: ClientSession) {
  const selected = target(actor, scope);
  const collection = selected.collection;
  const filter = selected.filter as mongoose.mongo.Filter<mongoose.mongo.Document>;
  const db = mongoose.connection.db!;
  const docs: mongoose.mongo.WithId<mongoose.mongo.Document>[] = [];
  const encoded: string[] = [];
  let bytes = Buffer.byteLength(JSON.stringify({ version: 1, collection, scope, documents: [] }));
  // BSON preserves IDs, timestamps, binary fields and password-free raw record values without Mongoose projections.
  for await (const doc of db.collection(collection).find(filter, { session, promoteValues: false }).sort({ _id: 1 }).limit(20_001)) {
    if (docs.length === 20_000) throw Errors.badRequest("This scope exceeds the safe deletion limit. Select a smaller country or filter scope.");
    const value = Buffer.from(mongoose.mongo.BSON.serialize(doc)).toString("base64");
    bytes += value.length + 3;
    if (bytes > 64 * 1024 * 1024) throw Errors.badRequest("This scope exceeds the backup size limit. Select a smaller scope.");
    docs.push(doc); encoded.push(value);
  }
  const payload = JSON.stringify({ version: 1, collection, scope, documents: encoded });
  return { docs, payload, digest: hash(payload), collection, filter };
}

export async function prepareDailyDeletion(actor: Actor, input: unknown) {
  assertOwner(actor);
  const scope = scopeSchema.parse(input);
  const token = randomUUID();
  const file = backupPath(token);
  const snap = await snapshot(actor, scope);
  if (!snap.docs.length) throw Errors.badRequest("No matching records to delete.");
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, snap.payload, { flag: "wx", mode: 0o600 });
  if (hash(await readFile(file)) !== snap.digest) throw Errors.conflict("Backup verification failed. No records were deleted.");
  // Reuse the existing settings collection, storing only a small receipt, never duplicate business records.
  await SystemSetting.deleteMany({ key: /^daily-delete:/, "value.expires": { $lt: Date.now() } });
  const ticket: Ticket = { scope, actorId: actor.id, count: snap.docs.length, digest: snap.digest, stage: 1, expires: Date.now() + 30 * 60_000 };
  await SystemSetting.create({ key: keyFor(token), value: ticket });
  return { token, count: ticket.count, day: scope.day, category: scope.category, backupVerified: true, stage: 1 };
}

export async function advanceDailyDeletion(actor: Actor, input: unknown) {
  assertOwner(actor);
  const request = requestSchema.parse(input);
  const key = keyFor(request.token);
  const receipt = await SystemSetting.findOne({ key }).lean<{ value: Ticket }>();
  const ticket = receipt?.value as Ticket | undefined;
  if (!ticket || ticket.actorId !== actor.id || ticket.expires < Date.now()) throw Errors.conflict("Confirmation expired. Restart the confirmation process.");
  if (request.action === "delete" && ticket.stage === 4) return { deleted: ticket.deleted, stage: 4 };
  const expected = request.action === "continue" ? 1 : request.action === "acknowledge" ? 2 : 3;
  if (ticket.stage !== expected) throw Errors.conflict("Complete each confirmation step in order.");
  if (request.action === "acknowledge" && request.acknowledged !== true) throw Errors.badRequest("Check the permanent deletion acknowledgement.");
  if (request.action === "delete" && request.confirmation !== `DELETE ${ticket.scope.day}`) throw Errors.badRequest("The typed date does not match.");
  const backup = await readFile(backupPath(request.token)).catch(() => { throw Errors.conflict("Verified backup is unavailable. No records were deleted."); });
  if (hash(backup) !== ticket.digest) throw Errors.conflict("Backup integrity check failed. No records were deleted.");

  const check = async (session?: ClientSession) => {
    const snap = await snapshot(actor, ticket.scope, session);
    if (snap.docs.length !== ticket.count || snap.digest !== ticket.digest) {
      await SystemSetting.updateOne({ key, "value.stage": expected }, { $set: { "value.stage": -1 } });
      throw Errors.conflict("Matching records changed. Restart the confirmation process.");
    }
    return snap;
  };
  if (request.action !== "delete") {
    await check();
    const result = await SystemSetting.updateOne({ key, "value.stage": expected }, { $set: { "value.stage": expected + 1 } });
    if (result.modifiedCount !== 1) throw Errors.conflict("Confirmation already submitted.");
    return { stage: expected + 1, count: ticket.count };
  }
  try {
    return await mongoose.connection.transaction(async session => {
      const current = await SystemSetting.findOne({ key }).session(session).lean<{ value: Ticket }>();
      if (current?.value.stage === 4) return { stage: 4, deleted: current.value.deleted };
      const snap = await check(session);
      const claimed = await SystemSetting.updateOne({ key, "value.stage": 3 }, { $set: { "value.stage": 4, "value.deleted": ticket.count } }, { session });
      if (claimed.modifiedCount !== 1) throw Errors.conflict("Deletion already submitted. Refresh the page.");
      // Always intersect the validated scope with the backed-up snapshot IDs. Later arrivals cannot be deleted.
      const result = await mongoose.connection.db!.collection(snap.collection).deleteMany({ $and: [snap.filter, { _id: { $in: snap.docs.map(doc => doc._id) } }] }, { session });
      if (result.deletedCount !== ticket.count) throw Errors.conflict("Record count changed. Restart confirmation.");
      if (ticket.scope.category === "company") {
        // Keep existing dashboard counters consistent, without touching source totals or unrelated records.
        const days = new Map(snap.docs.filter(doc => isDay(doc.registrationDay)).map(doc => [JSON.stringify([doc.countryCode, doc.registrationDay, doc.isDemo === true]), { countryCode: doc.countryCode as string, date: doc.registrationDay as string, isDemo: doc.isDemo === true }]));
        for (const day of days.values()) {
          const [counts] = await Company.aggregate([
            { $match: { countryCode: day.countryCode, registrationDay: day.date, isDemo: day.isDemo ? true : { $ne: true }, eventType: { $in: ["NEW_ENTITY", null] } } },
            { $group: { _id: null, newCompanies: { $sum: 1 }, withEmail: { $sum: { $cond: ["$contactFlags.email", 1, 0] } }, withPhone: { $sum: { $cond: [{ $or: ["$contactFlags.phone", "$contactFlags.mobile"] }, 1, 0] } }, withWebsite: { $sum: { $cond: ["$contactFlags.website", 1, 0] } }, withContactPerson: { $sum: { $cond: ["$contactFlags.person", 1, 0] } }, fullyContactable: { $sum: { $cond: ["$fullyContactable", 1, 0] } }, withDirectContact: { $sum: { $cond: ["$directContact.has", 1, 0] } } } },
          ]).session(session);
          const { _id: _group, ...values } = counts ?? { newCompanies: 0, withEmail: 0, withPhone: 0, withWebsite: 0, withContactPerson: 0, fullyContactable: 0, withDirectContact: 0 };
          void _group;
          await DailyRegistrationSnapshot.updateOne(day, { $set: { ...values, lastUpdatedAt: new Date() } }, { session });
        }
      }
      return { stage: 4, deleted: result.deletedCount };
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  } catch (error) {
    if ((error as { code?: number }).code === 20) throw new AppError(503, "TRANSACTIONS_REQUIRED", "Daily deletion requires a MongoDB replica set. No records were deleted.");
    throw error;
  }
}
