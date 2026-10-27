import "server-only";
import type { AnyBulkWriteOperation, Types } from "mongoose";
import { getCountry } from "@/config/countries";
import { Company, Country, DailyRegistrationSnapshot, RegistrySync, type CountryDoc, type RegistrySyncDoc } from "@/models";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { contactQuality } from "@/lib/company-fields";
import { addDays, daysBetween, eachDay, todayIn, type Day } from "@/lib/dates/country-time";
import type { Actor } from "@/lib/permissions";
import { rescoreCompanies } from "@/features/companies/service";
import { getRegistryProvider } from "./providers";
import { mapLimit } from "./http";
import { buildCompanyUpdate, personOrUndefined, registryContacts, type ExistingCompany } from "./normalize";
import type { CompanyRegistryProvider, NormalizedCompany, ProviderStatus } from "./types";

/**
 * Registry synchronization engine.
 *
 *   syncToday(country)       — today's registrations (the "Sync Today" button)
 *   syncDate(country, day)   — one registry day
 *   syncCountry(country)     — incremental: from the last successful day to today
 *                              (first run backfills `backfillDays`)
 *
 * fetch → normalize → dedupe (country + registration number / source id) →
 * merge with existing contact provenance → upsert → people/roles for recent
 * companies → score → daily snapshots. Every run is logged in RegistrySync.
 *
 * On failure nothing is replaced: the provider is marked unavailable and the
 * last successful data stays, clearly timestamped.
 */
const MAX_PER_RUN = Number(process.env.REGISTRY_MAX_PER_RUN || 5000);
const PEOPLE_PER_RUN = Number(process.env.REGISTRY_PEOPLE_PER_RUN || 300);
const MAX_INCREMENTAL_DAYS = 14;
const STALE_RUN_MS = 10 * 60_000;

export type SyncKind = "TODAY" | "DATE" | "RANGE" | "BACKFILL";
export type SyncRequest = {
  countryCode: string;
  kind: SyncKind;
  from?: Day;
  to?: Day;
  trigger: "MANUAL" | "SCHEDULED" | "SEED";
  actor?: Actor | null;
};

export type SyncResult = {
  id: string;
  status: "SUCCESS" | "PARTIAL" | "FAILED";
  countryCode: string;
  from: Day;
  to: Day;
  fetched: number;
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  peopleFetched: number;
  durationMs: number;
  complete: boolean;
  sourceTotal?: number;
  errors: string[];
};

type Prepared = { country: CountryDoc; provider: CompanyRegistryProvider; from: Day; to: Day; kind: SyncKind };

export function providerStateFor(provider: CompanyRegistryProvider): ProviderStatus["state"] | null {
  if (!provider.capabilities.supportsDailyRegistrations || !provider.getRegistrations) return "NOT_CONNECTED";
  if (!provider.isConfigured()) return "CREDENTIALS_REQUIRED";
  return null;
}

/** Validate the request and resolve the day window in the country's timezone. */
async function prepare(req: SyncRequest): Promise<Prepared> {
  const code = req.countryCode.toUpperCase();
  const def = getCountry(code);
  const country = await Country.findOne({ code }).lean<CountryDoc>();
  if (!def || !country) throw Errors.notFound("Country not configured");
  if (!country.enabled && req.trigger !== "SEED") throw Errors.badRequest("This country is disabled.");
  const provider = getRegistryProvider(country.providerId);
  if (!provider) throw Errors.badRequest("No registry provider is configured for this country.");
  const blocked = providerStateFor(provider);
  if (blocked === "NOT_CONNECTED") throw Errors.badRequest(`${def.name} has no connected registration feed. ${provider.limitations ?? ""}`.trim());
  if (blocked === "CREDENTIALS_REQUIRED") throw Errors.badRequest(`${provider.sourceName} needs credentials: set ${provider.requiredEnv.join(", ")} on the server.`);

  const today = todayIn(def.timezone);
  let from: Day;
  let to: Day = today;
  if (req.kind === "TODAY") from = today;
  else if (req.kind === "DATE") {
    if (!req.from) throw Errors.badRequest("A date is required.");
    from = to = req.from;
  } else if (req.kind === "RANGE") {
    if (!req.from || !req.to) throw Errors.badRequest("A date range is required.");
    [from, to] = req.from <= req.to ? [req.from, req.to] : [req.to, req.from];
  } else {
    // Incremental: re-check the last successful day (late updates) through today.
    const lastDay = country.lastSuccessAt ? todayIn(def.timezone, country.lastSuccessAt) : null;
    from = lastDay ? addDays(lastDay, -Math.max(1, provider.lookbackDays ?? 1)) : addDays(today, -(country.backfillDays ?? 7));
    if (daysBetween(from, today) > MAX_INCREMENTAL_DAYS) from = addDays(today, -MAX_INCREMENTAL_DAYS);
  }
  if (to > today) to = today;
  if (from > to) throw Errors.badRequest("Registrations cannot be synced for future dates.");
  if (daysBetween(from, to) > 92) throw Errors.badRequest("Sync at most 92 days at a time.");
  return { country, provider, from, to, kind: req.kind };
}

/** Mark runs that stopped heart-beating (server restart) as interrupted. */
async function clearStaleRuns(countryCode: string) {
  await RegistrySync.updateMany(
    { countryCode, status: "RUNNING", $or: [{ heartbeatAt: { $lt: new Date(Date.now() - STALE_RUN_MS) } }, { heartbeatAt: null, startedAt: { $lt: new Date(Date.now() - STALE_RUN_MS) } }] },
    { $set: { status: "FAILED", finishedAt: new Date(), errorLog: ["Interrupted (server restarted or timed out)."] } },
  );
}

async function createRun(p: Prepared, req: SyncRequest) {
  await clearStaleRuns(p.country.code);
  const running = await RegistrySync.findOne({ countryCode: p.country.code, status: "RUNNING" }).lean<RegistrySyncDoc>();
  if (running) return { run: running, alreadyRunning: true };
  const run = await RegistrySync.create({
    countryCode: p.country.code,
    providerId: p.provider.id,
    trigger: req.trigger,
    kind: p.kind,
    rangeFrom: p.from,
    rangeTo: p.to,
    status: "RUNNING",
    heartbeatAt: new Date(),
    triggeredBy: req.actor?.id,
    isLiveSource: !p.provider.isDemo,
  });
  return { run: run.toObject() as RegistrySyncDoc, alreadyRunning: false };
}

/** Start a sync in the background and return immediately (used by the dashboard buttons). */
export async function startSync(req: SyncRequest) {
  const p = await prepare(req);
  const { run, alreadyRunning } = await createRun(p, req);
  if (!alreadyRunning) {
    void execute(String(run._id), p, req).catch((err) => console.error("[registry] sync crashed", err));
  }
  return { syncId: String(run._id), alreadyRunning, from: p.from, to: p.to };
}

/** Run a sync and wait for the result (scheduler, cron, scripts, tests). */
export async function runSync(req: SyncRequest): Promise<SyncResult> {
  const p = await prepare(req);
  const { run, alreadyRunning } = await createRun(p, req);
  if (alreadyRunning) throw Errors.conflict(`A ${p.country.code} sync is already running.`);
  return execute(String(run._id), p, req);
}

export const syncToday = (countryCode: string, opts: Omit<SyncRequest, "countryCode" | "kind"> = { trigger: "MANUAL" }) => runSync({ ...opts, countryCode, kind: "TODAY" });
export const syncDate = (countryCode: string, day: Day, opts: Omit<SyncRequest, "countryCode" | "kind" | "from"> = { trigger: "MANUAL" }) => runSync({ ...opts, countryCode, kind: "DATE", from: day });
export const syncCountry = (countryCode: string, opts: Omit<SyncRequest, "countryCode" | "kind"> = { trigger: "SCHEDULED" }) => runSync({ ...opts, countryCode, kind: "BACKFILL" });

async function execute(syncId: string, p: Prepared, req: SyncRequest): Promise<SyncResult> {
  const started = Date.now();
  const code = p.country.code;
  const errors: string[] = [];
  let fetched = 0;
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let peopleFetched = 0;
  let complete = true;
  let sourceTotal: number | undefined;
  let lastBeat = 0;
  const beat = (progress: string, force = false) => {
    if (!force && Date.now() - lastBeat < 2000) return;
    lastBeat = Date.now();
    void RegistrySync.updateOne({ _id: syncId }, { $set: { progress, heartbeatAt: new Date() } }).catch(() => undefined);
  };

  try {
    beat(`Fetching ${p.from === p.to ? p.from : `${p.from} → ${p.to}`} from ${p.provider.sourceName}…`, true);
    const batch = await p.provider.getRegistrations!(p.from, p.to, { limit: MAX_PER_RUN, log: (m) => beat(m) });
    fetched = batch.companies.length;
    complete = batch.complete;
    sourceTotal = batch.total;
    if (!batch.complete) errors.push(`The source reported ${batch.total ?? "more"} records; ${fetched} were imported (per-run cap ${MAX_PER_RUN}).`);

    beat(`Saving ${batch.companies.length} companies…`, true);
    const r = await ingestCompanies(p.provider, code, batch.companies, { onProgress: (m) => beat(m) });
    imported += r.imported;
    updated += r.updated;
    skipped += r.skipped;
    failed += r.failed;
    errors.push(...r.errors);
    const records = r.records;

    peopleFetched = await fetchPeopleForRecent(p, records.map((x) => x.identity.sourceId), beat, errors);
    await rescoreCompanies({ countryCode: code, source: p.provider.id, sourceId: { $in: records.map((x) => x.identity.sourceId) } });
    // Sources that publish with a lag (SHAB) can return companies registered before the
    // window; their days' counts are rebuilt too. For every other source this is p.from.
    const earliest = records.reduce<Day>((min, x) => (x.registration.registrationDay && x.registration.registrationDay < min ? x.registration.registrationDay : min), p.from);
    const snapshotFrom = daysBetween(earliest, p.from) <= 31 ? earliest : p.from;
    await rebuildSnapshots(code, snapshotFrom, p.to, { providerId: p.provider.id, isDemo: p.provider.isDemo, complete, sourceTotal: p.from === p.to && snapshotFrom === p.from ? sourceTotal : undefined });
  } catch (err) {
    failed = Math.max(failed, 1);
    errors.unshift(err instanceof Error ? err.message : String(err));
  }

  const fatal = fetched === 0 && failed > 0;
  const status: SyncResult["status"] = fatal ? "FAILED" : errors.length ? "PARTIAL" : "SUCCESS";
  const durationMs = Date.now() - started;
  const finishedAt = new Date();
  await RegistrySync.updateOne(
    { _id: syncId },
    { $set: { status, finishedAt, heartbeatAt: finishedAt, durationMs, fetched, imported, updated, skipped, failed, peopleFetched, complete, sourceTotal, progress: undefined, errorLog: errors.slice(0, 50) } },
  );
  await Country.updateOne(
    { code },
    {
      $set: {
        lastSyncAt: finishedAt,
        lastSyncStatus: status,
        lastSyncId: syncId,
        ...(status !== "FAILED" && { lastSuccessAt: finishedAt }),
        providerStatus: status === "FAILED" ? { state: "UNAVAILABLE", message: errors[0], checkedAt: finishedAt } : { state: "CONNECTED", checkedAt: finishedAt },
      },
    },
  );
  await audit(req.actor ?? null, "registry.sync", {
    entityType: "RegistrySync",
    entityId: syncId,
    countryCode: code,
    metadata: { provider: p.provider.id, trigger: req.trigger, kind: p.kind, from: p.from, to: p.to, fetched, imported, updated, skipped, failed, status },
  });

  return { id: syncId, status, countryCode: code, from: p.from, to: p.to, fetched, imported, updated, skipped, failed, peopleFetched, durationMs, complete, sourceTotal, errors };
}

export type IngestResult = { imported: number; updated: number; skipped: number; failed: number; errors: string[]; records: NormalizedCompany[]; newIds: string[]; days: Day[] };

/**
 * Store a batch of normalized companies (shared by day syncs and live feeds):
 * dedupe → merge with contact provenance → idempotent upsert → registry contacts
 * with classification → shared-contact detection → direct-contact ranking →
 * research queued for new companies (never blocks their appearance).
 */
export async function ingestCompanies(provider: CompanyRegistryProvider, code: string, input: NormalizedCompany[], opts: { onProgress?: (m: string) => void } = {}): Promise<IngestResult> {
  const out: IngestResult = { imported: 0, updated: 0, skipped: 0, failed: 0, errors: [], records: [], newIds: [], days: [] };
  const byId = new Map<string, NormalizedCompany>();
  for (const n of input) {
    if (!n.identity.sourceId || !n.identity.name) {
      out.failed++;
      if (out.errors.length < 50) out.errors.push(`Skipped a record without id/name (${n.identity.sourceId ?? "unknown"}).`);
      continue;
    }
    byId.set(n.identity.sourceId, n);
  }
  const records = [...byId.values()];
  out.records = records;
  const now = new Date();
  for (let i = 0; i < records.length; i += 500) {
    const chunk = records.slice(i, i + 500);
    const existing = await Company.find({ countryCode: code, source: provider.id, sourceId: { $in: chunk.map((r) => r.identity.sourceId) } })
      .select("+sourceHash sourceId email phone mobile website address contactPerson contactSources eligibility")
      .lean<(ExistingCompany & { sourceId: string })[]>();
    const existingById = new Map(existing.map((e) => [e.sourceId, e]));
    const ops: AnyBulkWriteOperation[] = [];
    for (const n of chunk) {
      const prev = existingById.get(n.identity.sourceId);
      const { set, unset, unchanged } = buildCompanyUpdate(n, provider, code, prev, now);
      if (unchanged) {
        out.skipped++;
        ops.push({ updateOne: { filter: { _id: prev!._id }, update: { $set: { sourceFetchedAt: now } } } });
        continue;
      }
      if (prev) out.updated++;
      ops.push({
        updateOne: {
          filter: { countryCode: code, source: provider.id, sourceId: n.identity.sourceId },
          update: {
            $set: set,
            ...(Object.keys(unset).length && { $unset: unset }),
            $setOnInsert: { countryCode: code, source: provider.id, sourceId: n.identity.sourceId, firstSeenAt: now, lead: { stage: "NEW", score: 0, saved: false } },
          },
          upsert: true,
        },
      });
    }
    try {
      const res = await Company.bulkWrite(ops, { ordered: false });
      out.imported += res.upsertedCount;
      out.newIds.push(...Object.values(res.upsertedIds ?? {}).map(String));
    } catch (err) {
      // Duplicate registration numbers from another source etc. — count, keep going.
      const e = err as { writeErrors?: { errmsg?: string }[]; result?: { upsertedCount?: number; upsertedIds?: Record<string, unknown> } };
      out.imported += e.result?.upsertedCount ?? 0;
      out.newIds.push(...Object.values(e.result?.upsertedIds ?? {}).map(String));
      out.failed += e.writeErrors?.length || 1;
      if (out.errors.length < 50) out.errors.push(e.writeErrors?.[0]?.errmsg ?? (err instanceof Error ? err.message : String(err)));
    }
    await recordRegistryContacts(code, provider, chunk);
    opts.onProgress?.(`Saved ${Math.min(i + 500, records.length)}/${records.length}`);
  }
  out.days = [...new Set(records.map((r) => r.registration.registrationDay).filter((d): d is Day => !!d))];
  // Research is queued, never awaited: new companies appear in the table immediately.
  if (!provider.isDemo && out.newIds.length) {
    const fresh = await Company.find({ _id: { $in: out.newIds } }).select("_id registrationDay").lean<{ _id: unknown; registrationDay?: string }[]>();
    const { enqueueResearch } = await import("@/features/research/engine");
    for (const c of fresh) await enqueueResearch(String(c._id), { reason: "new", registrationDay: c.registrationDay }).catch(() => undefined);
  }
  return out;
}

/** Keep registry contact values in the provenance store (classified), then re-rank the companies. */
async function recordRegistryContacts(countryCode: string, provider: CompanyRegistryProvider, records: NormalizedCompany[]) {
  const withContacts = records.filter((r) => registryContacts(r).length);
  if (!withContacts.length) return;
  const docs = await Company.find({ countryCode, source: provider.id, sourceId: { $in: withContacts.map((r) => r.identity.sourceId) } })
    .select("_id sourceId countryCode isDemo")
    .lean<{ _id: Types.ObjectId; sourceId: string; countryCode: string; isDemo?: boolean }[]>();
  const bySource = new Map(docs.map((d) => [d.sourceId, d]));
  const { recordContact, recomputeCompanyContacts, flagSharedContacts } = await import("@/features/research/contacts");
  const values: string[] = [];
  for (const r of withContacts) {
    const company = bySource.get(r.identity.sourceId);
    if (!company) continue;
    for (const c of registryContacts(r)) {
      await recordContact(company, { type: c.type, value: c.value, role: c.role, sourceKind: provider.isDemo ? "MANUAL" : "REGISTRY", source: provider.sourceName, sourceUrl: r.source.url, provider: provider.id, ownership: "CONFIRMED" });
      if (c.type === "EMAIL" || c.type === "PHONE" || c.type === "MOBILE") values.push(c.value);
    }
    await recomputeCompanyContacts(company._id);
  }
  await flagSharedContacts(values);
}

/**
 * Fetch people/roles for the most recently registered companies in this run
 * (providers that expose them separately). Capped per run; the profile page
 * loads the rest on demand.
 */
async function fetchPeopleForRecent(p: Prepared, sourceIds: string[], beat: (m: string) => void, errors: string[]) {
  if (!p.provider.getPeople || !p.provider.capabilities.supportsRoles) return 0;
  const def = getCountry(p.country.code)!;
  const recentFrom = addDays(todayIn(def.timezone), -2);
  const targets = await Company.find({ countryCode: p.country.code, source: p.provider.id, sourceId: { $in: sourceIds }, peopleFetchedAt: null, registrationDay: { $gte: recentFrom } })
    .select("_id registrationNumber sourceId email phone mobile website address city contactPerson contactSources")
    .sort({ registrationDay: -1 })
    .limit(PEOPLE_PER_RUN)
    .lean<(ExistingCompany & { _id: unknown; registrationNumber?: string; sourceId: string; city?: string })[]>();
  let done = 0;
  let failures = 0;
  await mapLimit(targets, 2, async (c) => {
    if (failures >= 5) return; // stop early if the roles endpoint is failing
    try {
      const { people, contactPerson } = await p.provider.getPeople!(c.registrationNumber ?? c.sourceId);
      await applyPeople(c, people, contactPerson, p.provider);
      done++;
      beat(`Roles ${done}/${targets.length}`);
    } catch (err) {
      failures++;
      if (failures === 5) errors.push(`Roles lookups stopped after repeated errors: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  return done;
}

/** Store people + registry contact person and refresh data-quality flags. */
export async function applyPeople(
  c: ExistingCompany & { _id: unknown; city?: string | null },
  people: { name: string; role: string; roleCode?: string; group?: string }[],
  contactPerson: { name: string; role: string; roleCode?: string; group?: string } | undefined,
  provider: CompanyRegistryProvider,
) {
  const set: Record<string, unknown> = { people, peopleFetchedAt: new Date() };
  let person = c.contactPerson ?? undefined;
  const cp = personOrUndefined(contactPerson);
  if (cp && (!c.contactPerson?.name || c.contactSources?.contactPerson?.kind === "REGISTRY")) {
    person = cp;
    set.contactPerson = cp;
    set["contactSources.contactPerson"] = { kind: "REGISTRY", source: provider.sourceName, at: new Date() };
  }
  const q = contactQuality({ ...c, address: c.address ?? c.city, contactPerson: person });
  set.contactFlags = q.flags;
  set.completeness = q.completeness;
  set.fullyContactable = q.fullyContactable;
  await Company.updateOne({ _id: c._id }, { $set: set });
}

/** Recompute daily snapshots from the Company collection for the given days. */
export async function rebuildSnapshots(countryCode: string, from: Day, to: Day, meta: { providerId?: string; isDemo: boolean; complete: boolean; sourceTotal?: number }) {
  const rows = await Company.aggregate<{ _id: string; n: number; email: number; phone: number; website: number; person: number; full: number; direct: number }>([
    { $match: { countryCode, isDemo: meta.isDemo ? true : { $ne: true }, registrationDay: { $gte: from, $lte: to }, eventType: { $in: ["NEW_ENTITY", null] } } },
    {
      $group: {
        _id: "$registrationDay",
        n: { $sum: 1 },
        email: { $sum: { $cond: ["$contactFlags.email", 1, 0] } },
        phone: { $sum: { $cond: [{ $or: ["$contactFlags.phone", "$contactFlags.mobile"] }, 1, 0] } },
        website: { $sum: { $cond: ["$contactFlags.website", 1, 0] } },
        person: { $sum: { $cond: ["$contactFlags.person", 1, 0] } },
        full: { $sum: { $cond: ["$fullyContactable", 1, 0] } },
        direct: { $sum: { $cond: ["$directContact.has", 1, 0] } },
      },
    },
  ]);
  const byDay = new Map(rows.map((r) => [r._id, r]));
  const now = new Date();
  const ops = eachDay(from, to).map((date) => {
    const r = byDay.get(date);
    return {
      updateOne: {
        filter: { countryCode, isDemo: meta.isDemo, date },
        update: {
          $set: {
            newCompanies: r?.n ?? 0,
            withEmail: r?.email ?? 0,
            withPhone: r?.phone ?? 0,
            withWebsite: r?.website ?? 0,
            withContactPerson: r?.person ?? 0,
            fullyContactable: r?.full ?? 0,
            withDirectContact: r?.direct ?? 0,
            complete: meta.complete,
            providerId: meta.providerId,
            lastUpdatedAt: now,
            ...(meta.sourceTotal !== undefined && { sourceTotal: meta.sourceTotal }),
          },
        },
        upsert: true,
      },
    };
  });
  if (ops.length) await DailyRegistrationSnapshot.bulkWrite(ops, { ordered: false });
}

/** Scheduled syncs: every enabled, connected country whose interval has elapsed. */
export async function runDueSyncs(log: (m: string) => void = () => undefined) {
  const countries = await Country.find({ enabled: true, syncEnabled: true }).lean<CountryDoc[]>();
  const results: { country: string; status: string; imported?: number; error?: string }[] = [];
  for (const c of countries) {
    const provider = getRegistryProvider(c.providerId);
    if (!provider) continue;
    const blocked = providerStateFor(provider);
    if (blocked) {
      if (c.providerStatus?.state !== blocked) {
        await Country.updateOne({ code: c.code }, { $set: { providerStatus: { state: blocked, message: blocked === "CREDENTIALS_REQUIRED" ? `Set ${provider.requiredEnv.join(", ")}` : provider.limitations, checkedAt: new Date() } } });
      }
      continue;
    }
    const interval = (c.syncIntervalMinutes ?? provider.recommendedSyncMinutes) * 60_000;
    const due = !c.lastSyncAt || Date.now() - c.lastSyncAt.getTime() >= interval;
    if (!due) continue;
    try {
      log(`Syncing ${c.code} (${provider.id})`);
      const r = await syncCountry(c.code, { trigger: "SCHEDULED" });
      results.push({ country: c.code, status: r.status, imported: r.imported });
    } catch (err) {
      results.push({ country: c.code, status: "SKIPPED", error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

/** Recount already-synced snapshot days after contacts change (keeps their completeness flag). */
export async function refreshSnapshotDays(countryCode: string, days: (Day | null | undefined)[], isDemo = false) {
  for (const day of [...new Set(days.filter((d): d is Day => !!d))]) {
    const snap = await DailyRegistrationSnapshot.findOne({ countryCode, isDemo, date: day }).lean<{ complete?: boolean; providerId?: string }>();
    if (!snap) continue; // never create a snapshot for a day that was not synced
    await rebuildSnapshots(countryCode, day, day, { providerId: snap.providerId, isDemo, complete: snap.complete !== false });
  }
}

/** Record when each connected source last published (e.g. CRO dataset modification time). */
export async function checkLatestPublications() {
  const countries = await Country.find({ enabled: true }).lean<CountryDoc[]>();
  for (const c of countries) {
    const provider = getRegistryProvider(c.providerId);
    if (!provider?.getLatestPublication || providerStateFor(provider)) continue;
    const fresh = c.latestPublicationAt && Date.now() - new Date(c.latestPublicationAt).getTime() < 3_600_000;
    if (fresh) continue;
    try {
      const at = await provider.getLatestPublication();
      if (at) await Country.updateOne({ code: c.code }, { $set: { latestPublicationAt: at } });
    } catch {
      /* status check only */
    }
  }
}
