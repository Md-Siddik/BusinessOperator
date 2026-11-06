import mongoose from "mongoose";
import { createHash } from "node:crypto";

type Db = mongoose.mongo.Db;
// Historical daily data and disposable processing state. `jobs` is the background queue,
// not Job Intelligence. Rebuild queues/cursors after cutover so jobs cannot refer to omitted data.
export const OMIT = new Set(["opportunities", "opportunityevents", "opportunitysyncruns", "registrysyncs", "dailyregistrationsnapshots", "jobs", "checkpoints", "providerusages", "authratelimits", "auditlogs", "webanalytics", "webanalyticsvisits", "webanalyticsevents", "webanalyticssessions", "webanalyticsdaily"]);
export const KEEP = new Set(["companies", "established_companies", "users", "organizations", "contacts", "crmactivities", "followups", "websiteaudits", "emailtemplates", "emailcampaigns", "emailmessages", "suppressionentries", "clientservices", "projects", "supporttickets", "documents", "conversations", "notifications", "systemsettings", "translations", "casestudies", "contactrequests", "counters", "inboxitems", "servicepackages", "quotations", "opportunityfeeds", "services", "leadassignments", "deletedidentities", "clientdeletions"]);
for (const name of ["countries", "clientdocuments", "messages", "projecttasks", "dailyregistrationsnapshots"]) { KEEP.add(name); OMIT.delete(name); }
for (const name of ["lookupcaches", "webvisitors", "websessions", "webpageviews", "webeventkeys", "webconversions", "webanalyticsdailies"]) OMIT.add(name);

export function canonical(doc: mongoose.mongo.Document): string {
  const sort = (value: unknown): unknown => Array.isArray(value) ? value.map(sort) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sort(item)])) : value;
  return JSON.stringify(sort(mongoose.mongo.BSON.EJSON.serialize(doc, { relaxed: false })));
}

export async function fingerprint(db: Db, name: string, excludeIds: unknown[] = []) {
  const hash = createHash("sha256");
  let count = 0;
  for await (const doc of db.collection(name).find((excludeIds.length ? { _id: { $nin: excludeIds } } : {}) as mongoose.mongo.Filter<mongoose.mongo.Document>, { promoteValues: false }).sort({ _id: 1 })) {
    hash.update(canonical(doc)); count++;
  }
  return { count, sha256: hash.digest("hex") };
}
export async function inventory(db: Db) {
  const result = [];
  for (const info of await db.listCollections({ type: "collection" }).toArray()) {
    if (info.name.startsWith("system.")) continue;
    const stats = await db.command({ collStats: info.name, scale: 1 });
    result.push({ name: info.name, policy: KEEP.has(info.name) ? "retain" : OMIT.has(info.name) ? "fresh" : "unclassified", count: await db.collection(info.name).countDocuments(), dataBytes: stats.size, storageBytes: stats.storageSize, indexBytes: stats.totalIndexSize, indexes: (await db.collection(info.name).listIndexes().toArray()).map(i => ({ name: i.name, key: i.key, unique: i.unique ?? false })) });
  }
  return result;
}

/** Insert missing IDs only. An existing, different target document is a conflict, never overwritten. */
export async function migrateSelected(source: Db, target: Db, options: { continueBusinessErrors?: boolean; onProgress?: (row: { collection: string; preserved: number; failed: number }) => void } = {}) {
  if (source.client === target.client && source.databaseName === target.databaseName) throw new Error("Source and destination must differ.");
  const infos = (await source.listCollections({ type: "collection" }).toArray()).filter(i => !i.name.startsWith("system."));
  const unknown = infos.filter(i => !KEEP.has(i.name) && !OMIT.has(i.name));
  // The inspected source has an unused empty legacy `User` collection. Never omit it if it contains accounts.
  for (let i = unknown.length - 1; i >= 0; i--) {
    if (unknown[i].name === "User" && await source.collection("User").countDocuments() === 0) unknown.splice(i, 1);
  }
  if (unknown.length) throw new Error("Unclassified collections require review: " + unknown.map(i => i.name).join(", "));
  for (const name of OMIT) {
    if (await target.collection(name).countDocuments() > 0) throw new Error(`Destination ${name} is not fresh. No target data was deleted.`);
  }
  // Preflight every retained collection before writing anything.
  const before = new Map<string, Awaited<ReturnType<typeof fingerprint>>>();
  for (const info of infos.filter(i => KEEP.has(i.name))) {
    before.set(info.name, await fingerprint(source, info.name));
    let existing: mongoose.mongo.WithId<mongoose.mongo.Document>[] = [];
    const verifyBatch = async () => {
      if (!existing.length) return;
      const originals = await source.collection(info.name).find({ _id: { $in: existing.map(doc => doc._id) } }, { promoteValues: false }).toArray();
      const byId = new Map(originals.map(doc => [canonical({ _id: doc._id }), canonical(doc)]));
      if (existing.some(doc => byId.get(canonical({ _id: doc._id })) !== canonical(doc))) throw new Error(`Destination conflict in ${info.name}; reconcile without overwriting either database.`);
      existing = [];
    };
    for await (const doc of target.collection(info.name).find({}, { promoteValues: false })) {
      existing.push(doc);
      if (existing.length >= 500) await verifyBatch();
    }
    await verifyBatch();
  }
  const report = [];
  let totalBusinessFailures = 0;
  for (const info of infos.filter(i => KEEP.has(i.name))) {
    const name = info.name;
    const targetCountBefore = await target.collection(name).countDocuments();
    if (!(await target.listCollections({ name }).hasNext())) await target.createCollection(name, "options" in info ? info.options : undefined);
    let inserted = 0;
    const failedIds: unknown[] = [];
    const failedRecords: { id: string; code: number | string }[] = [];
    let batch: mongoose.mongo.AnyBulkWriteOperation<mongoose.mongo.Document>[] = [];
    const flush = async () => {
      if (!batch.length) return;
      try {
        const result = await target.collection(name).bulkWrite(batch, { ordered: true });
        inserted += result.upsertedCount;
      } catch (error) {
        if (!options.continueBusinessErrors || !["companies", "established_companies"].includes(name)) throw error;
        // Retry the batch by stable ID: previously successful operations remain no-ops.
        for (const operation of batch) {
          if (!("updateOne" in operation)) throw error;
          const id = operation.updateOne.filter._id;
          try {
            await target.collection(name).updateOne(operation.updateOne.filter, operation.updateOne.update, { upsert: true });
          } catch (failure) {
            const code = (failure as { code?: number }).code;
            // Only individual validation/uniqueness/size errors are skippable. Network/auth/capacity failures stop.
            if (![11000, 121, 10334, 17419].includes(code ?? 0) || ++totalBusinessFailures > 25) throw failure;
            failedIds.push(id);
            failedRecords.push({ id: String(id), code: code! });
          }
        }
      }
      batch = [];
    };
    for await (const doc of source.collection(name).find({}, { promoteValues: false }).batchSize(500)) {
      batch.push({ updateOne: { filter: { _id: doc._id }, update: { $setOnInsert: doc }, upsert: true } });
      if (batch.length >= 500) await flush();
    }
    await flush();
    for (const index of await source.collection(name).listIndexes().toArray()) {
      if (index.name === "_id_") continue;
      const { key, v: _version, ns: _namespace, ...options } = index;
      void _version; void _namespace;
      const restoredKey = Object.fromEntries(Object.entries(key).flatMap(([field, direction]) => field === "_fts" ? Object.keys(index.weights ?? {}).map(field => [field, "text"]) : field === "_ftsx" ? [] : [[field, direction]]));
      await target.collection(name).createIndex(restoredKey as mongoose.mongo.IndexSpecification, options);
    }
    const after = await fingerprint(source, name);
    const copied = await fingerprint(target, name, failedIds);
    const expected = failedIds.length ? await fingerprint(source, name, failedIds) : after;
    if (JSON.stringify(before.get(name)) !== JSON.stringify(after) || JSON.stringify(expected) !== JSON.stringify(copied)) throw new Error(`Integrity check failed or source changed in ${name}. Keep traffic paused; no cutover is approved.`);
    inserted = await target.collection(name).countDocuments() - targetCountBefore;
    report.push({ collection: name, inserted, preserved: copied.count, failedRecords, verified: true });
    options.onProgress?.({ collection: name, preserved: copied.count, failed: failedRecords.length });
  }
  // Final whole-source pass catches modifications to collections copied earlier.
  for (const [name, original] of before) {
    if (JSON.stringify(await fingerprint(source, name)) !== JSON.stringify(original)) throw new Error(`Source changed in ${name}. Keep traffic paused and reconcile.`);
  }
  const finalNames = (await source.listCollections({ type: "collection" }).toArray()).filter(i => !i.name.startsWith("system.")).map(i => i.name).sort();
  if (JSON.stringify(finalNames) !== JSON.stringify(infos.map(i => i.name).sort())) throw new Error("Source collection list changed. Keep traffic paused and reconcile.");
  if (infos.some(i => i.name === "User") && await source.collection("User").countDocuments() > 0) throw new Error("Legacy User collection gained accounts. Keep traffic paused and review its migration policy.");
  return report;
}
