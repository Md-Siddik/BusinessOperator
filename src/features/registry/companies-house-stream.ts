import "server-only";
import { Checkpoint, Company, type CheckpointDoc } from "@/models";
import { addDays, todayIn } from "@/lib/dates/country-time";
import { getRegistryProvider } from "./providers";
import { normalizeChCompany, type ChCompany } from "./providers/companies-house";
import { ingestCompanies, syncCountry } from "./sync";

/**
 * Companies House Streaming API worker (one persistent server-side connection —
 * never one per browser session).
 *   GET https://stream.companieshouse.gov.uk/companies?timepoint=N   Basic auth: <stream key>:
 *   - newline-delimited JSON events; blank lines are heartbeats
 *   - resume from the last COMMITTED timepoint (saved after records are stored)
 *   - 416 = timepoint too old → gap recovery via the REST advanced search, then resume live
 *   - 429 = reconnecting too often → wait one minute (documented)
 *   - watchdog: no data or heartbeat for 2 minutes → reconnect
 * New incorporations are decided from company data (date_of_creation), not from event arrival.
 * Requires a separate STREAMING application key (UK_COMPANIES_HOUSE_STREAMING_API_KEY).
 */
const URL_BASE = process.env.UK_COMPANIES_HOUSE_STREAM_URL || "https://stream.companieshouse.gov.uk/companies";
const KEY = () => process.env.UK_COMPANIES_HOUSE_STREAMING_API_KEY || "";
const CHECKPOINT = "stream:companies-house";
const NEW_WINDOW_DAYS = 3;

type StreamEvent = { resource_kind?: string; resource_id?: string; data?: ChCompany & { date_of_creation?: string }; event?: { timepoint?: number; published_at?: string; type?: string } };

type State = { running: boolean; abort?: AbortController; lastEventAt?: number; connectedAt?: number; reconnects: number; lastError?: string; processed: number };
const g = globalThis as unknown as { __etChStream?: State };
const state: State = (g.__etChStream ??= { running: false, reconnects: 0, processed: 0 });

export function streamStatus() {
  return { configured: !!KEY(), running: state.running, connectedAt: state.connectedAt ? new Date(state.connectedAt) : null, lastEventAt: state.lastEventAt ? new Date(state.lastEventAt) : null, reconnects: state.reconnects, lastError: state.lastError, processed: state.processed };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Process a batch of stream events; returns the highest timepoint durably handled. Exported for tests. */
export async function handleStreamEvents(events: StreamEvent[]) {
  const provider = getRegistryProvider("companies-house");
  if (!provider) return null;
  const today = todayIn("Europe/London");
  const earliest = addDays(today, -NEW_WINDOW_DAYS);
  const fresh = events.filter((e) => e.resource_kind === "company-profile" && e.data?.company_number && e.data.date_of_creation && e.data.date_of_creation >= earliest);
  if (fresh.length) {
    const normalized = fresh.map((e) => {
      const n = normalizeChCompany(e.data!);
      if (e.event?.published_at) n.source.publishedAt = new Date(e.event.published_at);
      return n;
    });
    const r = await ingestCompanies(provider, "GB", normalized);
    if (r.newIds.length) {
      const { publishIntelUpdate } = await import("@/features/research/inbox");
      publishIntelUpdate({ countryCode: "GB", kind: "registrations", count: r.newIds.length, companyIds: r.newIds });
    }
  }
  // Changes to already-known companies are new evidence for contact research.
  const changedNumbers = events.filter((e) => e.resource_kind === "company-profile" && e.data?.company_number && !fresh.includes(e)).map((e) => e.data!.company_number);
  if (changedNumbers.length) {
    const known = await Company.find({ countryCode: "GB", sourceId: { $in: changedNumbers } }).select("_id registrationDay").limit(25).lean<{ _id: unknown; registrationDay?: string }[]>();
    const { enqueueResearch } = await import("@/features/research/engine");
    for (const k of known) await enqueueResearch(String(k._id), { reason: "registry-change", registrationDay: k.registrationDay });
  }
  const tps = events.map((e) => e.event?.timepoint).filter((t): t is number => typeof t === "number");
  const max = tps.length ? Math.max(...tps) : null;
  if (max !== null) {
    const delays = fresh.map((e) => (e.event?.published_at ? Date.now() - Date.parse(e.event.published_at) : null)).filter((d): d is number => d !== null);
    await Checkpoint.updateOne({ key: CHECKPOINT }, { $set: { value: String(max), lastSourceAt: new Date() }, ...(delays.length && { $push: { delaySamples: { $each: delays, $slice: -200 } } }) }, { upsert: true });
  }
  state.processed += events.length;
  return max;
}

async function connectOnce(): Promise<"retry" | "gap" | "throttled" | "stop"> {
  const cp = await Checkpoint.findOne({ key: CHECKPOINT }).lean<CheckpointDoc>();
  const url = cp?.value ? `${URL_BASE}?timepoint=${encodeURIComponent(cp.value)}` : URL_BASE;
  state.abort = new AbortController();
  const res = await fetch(url, { headers: { Authorization: `Basic ${Buffer.from(`${KEY()}:`).toString("base64")}` }, signal: state.abort.signal });
  if (res.status === 416) return "gap";
  if (res.status === 429) return "throttled";
  if (res.status === 401 || res.status === 403) {
    state.lastError = "Streaming key rejected — check UK_COMPANIES_HOUSE_STREAMING_API_KEY";
    return "stop";
  }
  if (!res.ok || !res.body) {
    state.lastError = `Stream responded ${res.status}`;
    return "retry";
  }
  state.connectedAt = Date.now();
  state.lastEventAt = Date.now();
  const watchdog = setInterval(() => {
    if (Date.now() - (state.lastEventAt ?? 0) > 120_000) state.abort?.abort();
  }, 15_000);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pending: StreamEvent[] = [];
  let lastFlush = Date.now();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      state.lastEventAt = Date.now();
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue; // heartbeat
        try {
          pending.push(JSON.parse(line) as StreamEvent);
        } catch {
          /* skip malformed line */
        }
      }
      if (pending.length >= 50 || (pending.length && Date.now() - lastFlush > 5_000)) {
        await handleStreamEvents(pending);
        pending = [];
        lastFlush = Date.now();
      }
    }
  } finally {
    clearInterval(watchdog);
    if (pending.length) await handleStreamEvents(pending).catch(() => undefined);
  }
  return "retry";
}

/** Start the persistent worker (idempotent). */
export function startCompaniesHouseStream() {
  if (state.running || !KEY() || process.env.UK_STREAM_WORKER === "off") return;
  state.running = true;
  void (async () => {
    let backoff = 60_000;
    while (state.running) {
      try {
        const r = await connectOnce();
        if (r === "stop") break;
        if (r === "gap") {
          // Timepoint too old: recover missed registrations via REST, then resume from live.
          state.lastError = "Stream timepoint too old (416) — gap recovered via REST advanced search";
          await syncCountry("GB", { trigger: "SCHEDULED", notify: false }).catch((e) => (state.lastError = `Gap recovery failed: ${e instanceof Error ? e.message : String(e)}`));
          await Checkpoint.deleteOne({ key: CHECKPOINT });
        }
        if (r === "throttled") state.lastError = "Stream throttled (429) — waiting one minute";
        state.reconnects++;
      } catch (err) {
        state.lastError = err instanceof Error ? err.message : String(err);
        state.reconnects++;
      }
      await sleep(backoff); // documented: wait at least one minute between reconnects
      backoff = Math.min(backoff * 2, 10 * 60_000);
      if (state.connectedAt && Date.now() - state.connectedAt > 10 * 60_000) backoff = 60_000;
    }
    state.running = false;
  })();
}

export function stopCompaniesHouseStream() {
  state.running = false;
  state.abort?.abort();
}
