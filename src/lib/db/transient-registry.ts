import { createHash } from "node:crypto";
import { Aggregator, Query as MemoryQuery, update } from "mingo";
import type { Model, Query, PipelineStage } from "mongoose";
import { Types, mongo } from "mongoose";

type Row = Record<string, unknown> & { _id: Types.ObjectId };
type Entry = { row: Row; expires: number };
const root = globalThis as typeof globalThis & { __registryMemory?: Map<string, Map<string, Entry>>; __registryExpiry?: NodeJS.Timeout };
const stores = root.__registryMemory ??= new Map();
const TTL = 15 * 60_000;
const MAX_ROWS = 20_000;
root.__registryExpiry ??= setInterval(() => { for (const name of stores.keys()) store(name); }, 60_000);
root.__registryExpiry.unref();
function store(name: string) {
  let rows = stores.get(name);
  if (!rows) { rows = new Map(); stores.set(name, rows); }
  for (const [id, entry] of rows) if (entry.expires <= Date.now()) rows.delete(id);
  return rows;
}
export function transientRows(name: string): Row[] { return [...store(name).values()].map(e => e.row); }
export function transientRow(name: string, id: unknown) { return store(name).get(String(id))?.row; }
export function forgetTransient(name: string, id: unknown) { store(name).delete(String(id)); }
export function clearTransientRegistry() { stores.clear(); }
/** Country/day in the ID lets another server refetch the selected row. */
export function registryRowId(country: string, day: string | undefined, source: string, sourceId: string) {
  return new Types.ObjectId(Buffer.from(country.slice(0, 2)).toString("hex") + (day ?? "1970-01-01").replaceAll("-", "") + createHash("sha256").update(`${source}:${sourceId}`).digest("hex").slice(0, 12));
}
export function rememberRegistryRow(name: string, row: Row) {
  const rows = store(name);
  rows.delete(String(row._id));
  rows.set(String(row._id), { row, expires: Date.now() + TTL });
  while (rows.size > MAX_ROWS) rows.delete(rows.keys().next().value!);
}
function identity(row: Record<string, unknown>) { return row.companyId ? `${row.companyId}:${row.type}:${row.value}` : `${row.countryCode}:${row.source}:${row.sourceId}`; }
function merge(persisted: Row[], temporary: Row[]) {
  const keys = new Set(temporary.map(identity));
  return [...persisted.filter(row => !keys.has(identity(row))), ...temporary];
}

/** Storage adapter: existing model queries also see bounded, volatile registry rows. */
export function withTransientRegistry<T>(model: Model<T>): Model<T> {
  const name = model.collection.name;
  const read = (query: Query<unknown, unknown>, one: boolean, count = false) => {
    const original = query.exec.bind(query);
    query.exec = async function () {
      if (!transientRows(name).length) return original();
      query.cast(model);
      const filter = query.getFilter();
      const options = query.getOptions();
      const projection = { ...query.projection() };
      const base = model.find(filter).setOptions({ ...options, skip: 0, limit: 0, sort: undefined });
      if (projection["+sourceData"]) base.select("+sourceData");
      if (projection["+sourceHash"]) base.select("+sourceHash");
      const persisted = await base.lean().exec() as Row[];
      let rows = merge(persisted, transientRows(name)).filter(row => new MemoryQuery(filter).test(row));
      if (count) return rows.length;
      const pipeline: Record<string, unknown>[] = [];
      if (options.sort) pipeline.push({ $sort: options.sort });
      if (options.skip) pipeline.push({ $skip: options.skip });
      if (one || options.limit) pipeline.push({ $limit: one ? 1 : options.limit });
      for (const key of Object.keys(projection)) if (key.startsWith("+")) delete projection[key];
      if (Object.keys(projection).length) pipeline.push({ $project: projection });
      else {
        const hidden = { ...(!query.projection()?.["+sourceData"] && { sourceData: 0 }), ...(!query.projection()?.["+sourceHash"] && { sourceHash: 0 }) };
        if (Object.keys(hidden).length) pipeline.push({ $project: hidden });
      }
      rows = new Aggregator(pipeline).run(rows) as Row[];
      const result = query.mongooseOptions().lean ? rows : rows.map(row => model.hydrate(row));
      const populate = query.mongooseOptions().populate;
      if (populate) await model.populate(result, Object.values(populate));
      return one ? result[0] ?? null : result;
    } as typeof query.exec;
    const cursor = query.cursor.bind(query);
    query.cursor = ((options: Parameters<typeof query.cursor>[0]) => {
      if (!transientRows(name).length) return cursor(options);
      return (async function* () { for (const row of await query.exec() as unknown[]) yield row; })();
    }) as unknown as typeof query.cursor;
    return query;
  };
  return new Proxy(model, {
    get(target, key, receiver) {
      if (key === "create" && name === "established_companies") return async (...args: unknown[]) => {
        const docs = Array.isArray(args[0]) ? args[0] : [args[0]];
        for (const doc of docs as Record<string, unknown>[]) {
          if (Array.isArray(doc.identityKeys) && transientRows(name).some(row => new MemoryQuery({ identityKeys: { $in: doc.identityKeys } }).test(row))) {
            throw new mongo.MongoServerError({ message: "E11000 duplicate key in temporary established-company identity keys", code: 11000 });
          }
        }
        return (Reflect.get(target, key) as (...args: unknown[]) => Promise<unknown>).apply(target, args);
      };
      if (["find", "findOne", "findById", "countDocuments"].includes(String(key))) return (...args: unknown[]) => {
        const method = Reflect.get(target, key) as (...args: unknown[]) => Query<unknown, unknown>;
        return read(method.apply(target, args), key === "findOne" || key === "findById", key === "countDocuments");
      };
      if (key === "aggregate") return (pipeline: Record<string, unknown>[] = []) => {
        const aggregate = target.aggregate(pipeline as unknown as PipelineStage[]);
        const exec = aggregate.exec.bind(aggregate);
        aggregate.exec = async () => {
          const stages = aggregate.pipeline();
          if (!transientRows(name).length && !stages.some(stage => "$lookup" in stage && typeof stage.$lookup.from === "string" && transientRows(stage.$lookup.from).length)) return exec();
          const first = stages[0] as { $match?: Record<string, unknown> } | undefined;
          const rows = merge(await target.find(first?.$match ?? {}).lean().exec() as Row[], transientRows(name));
          const collections = new Map<string, Row[]>();
          for (const stage of stages) if ("$lookup" in stage && typeof stage.$lookup.from === "string") {
            const from = stage.$lookup.from;
            collections.set(from, merge(await target.db.collection(from).find({}, { projection: { sourceData: 0, sourceHash: 0 } }).toArray() as Row[], transientRows(from)));
          }
          return new Aggregator(stages as unknown as Record<string, unknown>[], { collectionResolver: collection => collections.get(collection) ?? [], scriptEnabled: false }).run(rows);
        };
        return aggregate;
      };
      if (key === "deleteOne" || key === "deleteMany") return (...args: unknown[]) => {
        const method = Reflect.get(target, key) as (...args: unknown[]) => Query<unknown, unknown>;
        const query = method.apply(target, args);
        const exec = query.exec.bind(query);
        query.exec = async function () {
          query.cast(target);
          let rows = transientRows(name).filter(row => new MemoryQuery(query.getFilter()).test(row));
          if (!rows.length) return exec();
          if (key === "deleteOne") { rows = rows.slice(0, 1); query.setQuery({ _id: rows[0]._id }); }
          const persisted = new Set((await target.find(query.getFilter()).select("_id").lean().exec() as Row[]).map(row => String(row._id)));
          const result = await exec() as { acknowledged: boolean; deletedCount: number };
          for (const row of rows) forgetTransient(name, row._id);
          return { ...result, deletedCount: result.deletedCount + rows.filter(row => !persisted.has(String(row._id))).length };
        } as typeof query.exec;
        return query;
      };
      if (["updateOne", "findOneAndUpdate", "findByIdAndUpdate"].includes(String(key))) return (...args: unknown[]) => {
        const method = Reflect.get(target, key) as (...args: unknown[]) => Query<unknown, unknown>;
        const query = method.apply(target, args);
        const exec = query.exec.bind(query);
        query.exec = async function () {
          query.cast(target);
          const row = transientRows(name).find(row => new MemoryQuery(query.getFilter()).test(row));
          if (!row) return exec();
          const before = target.hydrate(row).toObject();
          update(row, query.getUpdate() as Parameters<typeof update>[1]);
          row.updatedAt = new Date();
          if (key === "updateOne") return { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0, upsertedId: null };
          const selected = query.getOptions().new ? row : before;
          return query.mongooseOptions().lean ? selected : target.hydrate(selected);
        } as typeof query.exec;
        return query;
      };
      return Reflect.get(target, key, receiver);
    },
  });
}
