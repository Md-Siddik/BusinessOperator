import "server-only";
import { siteConfig } from "@/config/site";

/**
 * Polite HTTP client for registry APIs. One instance per provider:
 *  - throttling: requests are serialized with a minimum interval
 *  - retries with exponential backoff on 429 / 5xx / network errors (honours Retry-After)
 *  - per-request timeout
 *  - circuit breaker: after N consecutive failures the provider is paused for a cooldown,
 *    so a broken government API is not hammered
 */
export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

export type HttpClientOptions = {
  name: string;
  minIntervalMs: number;
  timeoutMs?: number;
  maxRetries?: number;
  circuitThreshold?: number;
  circuitCooldownMs?: number;
};

type CircuitState = { failures: number; openUntil: number };

const USER_AGENT = `${siteConfig.name}-CompanyIntelligence/1.0 (+${siteConfig.url})`;
const g = globalThis as unknown as { __etHttpCircuits?: Map<string, CircuitState>; __etHttpQueues?: Map<string, Promise<void>> };
const circuits = (g.__etHttpCircuits ??= new Map());
const queues = (g.__etHttpQueues ??= new Map());

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new ProviderHttpError("Aborted"));
    });
  });

/** undici reports every network failure as "fetch failed"; the cause says which one (DNS, reset, TLS…). */
function withCause(err: Error) {
  const cause = err.cause as { code?: string; message?: string } | undefined;
  const detail = cause?.code ?? cause?.message;
  return detail && !err.message.includes(detail) ? `${err.message}: ${detail}` : err.message;
}

export function circuitState(name: string) {
  const c = circuits.get(name);
  return { open: !!c && c.openUntil > Date.now(), failures: c?.failures ?? 0, openUntil: c?.openUntil };
}

export function createHttpClient(opts: HttpClientOptions) {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const maxRetries = opts.maxRetries ?? 3;
  const threshold = opts.circuitThreshold ?? 5;
  const cooldown = opts.circuitCooldownMs ?? 5 * 60_000;

  /** Wait for this provider's slot (serializes requests with a minimum gap). */
  async function slot() {
    const prev = queues.get(opts.name) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    queues.set(opts.name, prev.then(() => next));
    await prev;
    setTimeout(release, opts.minIntervalMs);
  }

  function recordSuccess() {
    circuits.set(opts.name, { failures: 0, openUntil: 0 });
  }
  function recordFailure() {
    const c = circuits.get(opts.name) ?? { failures: 0, openUntil: 0 };
    c.failures += 1;
    if (c.failures >= threshold) c.openUntil = Date.now() + cooldown;
    circuits.set(opts.name, c);
  }

  async function request(url: string, init: RequestInit & { signal?: AbortSignal } = {}): Promise<Response> {
    if (circuitState(opts.name).open) {
      throw new ProviderHttpError(`${opts.name} is paused after repeated failures; retrying automatically later.`, undefined, true);
    }
    let attempt = 0;
    for (;;) {
      await slot();
      const signals = [AbortSignal.timeout(timeoutMs), ...(init.signal ? [init.signal] : [])];
      try {
        const res = await fetch(url, {
          ...init,
          headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...(init.headers ?? {}) },
          signal: AbortSignal.any(signals),
          cache: "no-store",
        });
        if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
          // 4xx (other than 429) are caller errors — not a provider outage.
          if (res.ok) recordSuccess();
          return res;
        }
        const retryAfter = Number(res.headers.get("retry-after"));
        await res.body?.cancel().catch(() => undefined);
        if (attempt >= maxRetries) {
          recordFailure();
          throw new ProviderHttpError(`${opts.name} responded ${res.status}`, res.status, true);
        }
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : 500 * 2 ** attempt, init.signal);
      } catch (err) {
        if (err instanceof ProviderHttpError) throw err;
        if (init.signal?.aborted) throw new ProviderHttpError("Aborted");
        if (attempt >= maxRetries) {
          recordFailure();
          const reason = err instanceof Error ? (err.name === "TimeoutError" ? "timed out" : withCause(err)) : String(err);
          throw new ProviderHttpError(`${opts.name} is unreachable (${reason})`, undefined, true);
        }
        await sleep(500 * 2 ** attempt, init.signal);
      }
      attempt++;
    }
  }

  async function json<T>(url: string, init: RequestInit & { signal?: AbortSignal } = {}): Promise<T> {
    const res = await request(url, init);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) throw new ProviderHttpError(`${opts.name} rejected the credentials (${res.status}). Check the API key configuration.`, res.status);
      throw new ProviderHttpError(`${opts.name} responded ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`, res.status);
    }
    return (await res.json()) as T;
  }

  return { request, json, name: opts.name };
}

export type HttpClient = ReturnType<typeof createHttpClient>;

/** Map over items with a fixed concurrency (the client still throttles each request). */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]!, idx);
      }
    }),
  );
  return out;
}
