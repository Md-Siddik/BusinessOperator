import "server-only";
import { getCountry } from "@/config/countries";
import { Checkpoint, Company, Contact, Country, CrmActivity, FollowUp, WebsiteAudit, type CheckpointDoc, type CountryDoc } from "@/models";
import { audit } from "@/lib/audit";
import { getRegistryProvider } from "./providers";
import { ingestCompanies, providerStateFor, refreshSnapshotDays } from "./sync";
import type { CompanyRegistryProvider } from "./types";

/**
 * Live change feeds (source-permitted incremental polling).
 * For each enabled country whose provider exposes pollChanges():
 *   poll from the stored cursor → ingest new companies → refresh changed known
 *   companies → delete source-removed records → rebuild snapshots → publish updates
 *   → save the cursor ONLY after everything above was stored (durable checkpoint).
 * Observed delay = our storage time − source publication time (application latency
 * is measured separately from registry publication delay).
 */
const MAX_PAGES_PER_TICK = 5;
const MAX_REFRESH_PER_TICK = 25;

export type FeedResult = { country: string; provider: string; newCompanies: number; changed: number; removed: number; cursor?: string; error?: string; storedAt?: Date };

async function refreshChanged(provider: CompanyRegistryProvider, countryCode: string, ids: string[]) {
  if (!ids.length || !provider.getCompany) return 0;
  const known = await Company.find({ countryCode, source: provider.id, sourceId: { $in: [...new Set(ids)] } }).select("_id sourceId registrationDay").limit(MAX_REFRESH_PER_TICK).lean<{ _id: unknown; sourceId: string; registrationDay?: string }[]>();
  let n = 0;
  for (const k of known) {
    try {
      const fresh = await provider.getCompany(k.sourceId, { signal: AbortSignal.timeout(15_000) });
      if (!fresh) continue;
      await ingestCompanies(provider, countryCode, [fresh]);
      // A registry change is new evidence: research the company again soon.
      const { enqueueResearch } = await import("@/features/research/engine");
      await enqueueResearch(String(k._id), { reason: "registry-change", registrationDay: k.registrationDay });
      n++;
    } catch {
      /* stays as-is; next registry change or day sync reconciles it */
    }
  }
  return n;
}

/** The source requires removal: delete our copy and its derived data (no suppression implied). */
async function removeCompanies(provider: CompanyRegistryProvider, countryCode: string, ids: string[]) {
  if (!ids.length) return 0;
  const docs = await Company.find({ countryCode, source: provider.id, sourceId: { $in: ids } }).select("_id").lean<{ _id: unknown }[]>();
  const companyIds = docs.map((d) => d._id);
  await Promise.all([Contact.deleteMany({ companyId: { $in: companyIds } }), CrmActivity.deleteMany({ companyId: { $in: companyIds } }), FollowUp.deleteMany({ companyId: { $in: companyIds } }), WebsiteAudit.deleteMany({ companyId: { $in: companyIds } }), Company.deleteMany({ _id: { $in: companyIds } })]);
  if (companyIds.length) await audit(null, "registry.source_removal", { countryCode, metadata: { provider: provider.id, count: companyIds.length } });
  return companyIds.length;
}

export async function pollCountryFeed(country: CountryDoc): Promise<FeedResult | null> {
  const provider = getRegistryProvider(country.providerId);
  if (!provider?.pollChanges || providerStateFor(provider)) return null;
  const key = `feed:${provider.id}`;
  const cp = await Checkpoint.findOne({ key }).lean<CheckpointDoc>();
  const due = !cp || Date.now() - new Date(cp.updatedAt).getTime() >= (provider.feedIntervalSeconds ?? 60) * 1000;
  if (!due) return null;
  const result: FeedResult = { country: country.code, provider: provider.id, newCompanies: 0, changed: 0, removed: 0 };
  try {
    let cursor = cp?.value ?? null;
    const days = new Set<string>();
    const delays: number[] = [];
    let lastSourceAt: Date | undefined;
    for (let page = 0; page < MAX_PAGES_PER_TICK; page++) {
      const batch = await provider.pollChanges(cursor, { limit: 200, signal: AbortSignal.timeout(60_000) });
      if (batch.newCompanies.length) {
        const r = await ingestCompanies(provider, country.code, batch.newCompanies);
        result.newCompanies += r.imported;
        r.days.forEach((d) => days.add(d));
        if (r.newIds.length) {
          const { publishIntelUpdate } = await import("@/features/research/inbox");
          publishIntelUpdate({ countryCode: country.code, kind: "registrations", count: r.imported, companyIds: r.newIds });
        }
      }
      result.changed += await refreshChanged(provider, country.code, batch.changedIds);
      result.removed += await removeCompanies(provider, country.code, batch.removedIds);
      const storedAt = new Date();
      for (const t of batch.publishedAts) {
        delays.push(storedAt.getTime() - t.getTime());
        if (!lastSourceAt || t > lastSourceAt) lastSourceAt = t;
      }
      // Durable checkpoint: only after the batch above is stored.
      cursor = batch.cursor;
      await Checkpoint.updateOne(
        { key },
        {
          $set: { value: cursor, ...(lastSourceAt && { lastSourceAt }), meta: { provider: provider.id, country: country.code } },
          ...(delays.length && { $push: { delaySamples: { $each: delays.splice(0), $slice: -200 } } }),
        },
        { upsert: true },
      );
      result.cursor = cursor;
      result.storedAt = storedAt;
      if (!batch.more) break;
    }
    // Recount only days a full sync already covered — a feed alone never claims a complete day.
    if (days.size) await refreshSnapshotDays(country.code, [...days], provider.isDemo);
    await Country.updateOne({ code: country.code }, { $set: { providerStatus: { state: "CONNECTED", checkedAt: new Date() } } });
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    // Feed errors never touch stored data; the day sync continues independently.
    await Checkpoint.updateOne({ key }, { $set: { "meta.lastError": result.error, "meta.lastErrorAt": new Date() } }).catch(() => undefined);
  }
  return result;
}

export async function runLiveFeeds(log: (m: string) => void = () => undefined) {
  const countries = await Country.find({ enabled: true, syncEnabled: true }).lean<CountryDoc[]>();
  const out: FeedResult[] = [];
  for (const c of countries) {
    const r = await pollCountryFeed(c);
    if (!r) continue;
    out.push(r);
    if (r.newCompanies || r.changed || r.removed || r.error) log(`${c.code} feed: ${r.newCompanies} new, ${r.changed} changed, ${r.removed} removed${r.error ? ` — ${r.error}` : ""}`);
  }
  return out;
}

/** Observed source→storage delay (median / p90, seconds) for a provider feed. */
export async function feedDelayStats(providerId: string) {
  const cp = await Checkpoint.findOne({ key: `feed:${providerId}` }).lean<CheckpointDoc>();
  const samples = [...(cp?.delaySamples ?? [])].sort((a, b) => a - b);
  if (!samples.length) return { samples: 0, medianSeconds: null as number | null, p90Seconds: null as number | null, lastSourceAt: cp?.lastSourceAt ?? null, lastPollAt: cp?.updatedAt ?? null, cursor: cp?.value ?? null };
  const pct = (p: number) => Math.round(samples[Math.min(samples.length - 1, Math.floor(p * samples.length))]! / 1000);
  return { samples: samples.length, medianSeconds: pct(0.5), p90Seconds: pct(0.9), lastSourceAt: cp?.lastSourceAt ?? null, lastPollAt: cp?.updatedAt ?? null, cursor: cp?.value ?? null };
}

export function countryTimezone(code: string) {
  return getCountry(code)?.timezone ?? "UTC";
}
