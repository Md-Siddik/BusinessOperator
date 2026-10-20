import "server-only";
import dns from "node:dns/promises";
import net from "node:net";
import { siteConfig } from "@/config/site";

/**
 * Polite, SSRF-safe page fetch for public company websites:
 *  - http(s) only; hostnames must resolve to public IP addresses (checked on every redirect hop)
 *  - robots.txt respected for our user agent
 *  - timeouts and a response size cap
 */
const USER_AGENT = `${siteConfig.name}-ContactFinder/1.0 (+${siteConfig.url})`;
const MAX_BYTES = 1_500_000;
const robotsCache = new Map<string, { at: number; disallow: string[] }>();

function isPrivateIp(ip: string) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168.");
}

export async function isPublicHost(hostname: string) {
  if (!hostname.includes(".") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".example")) return false;
  if (net.isIP(hostname)) return !isPrivateIp(hostname);
  try {
    const addrs = await dns.lookup(hostname, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

async function robotsDisallow(origin: string): Promise<string[]> {
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.at < 3_600_000) return cached.disallow;
  const disallow: string[] = [];
  try {
    const res = await fetch(`${origin}/robots.txt`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(5000), redirect: "follow" });
    if (res.ok) {
      let applies = false;
      for (const raw of (await res.text()).slice(0, 100_000).split(/\r?\n/)) {
        const line = raw.split("#")[0]!.trim();
        const idx = line.indexOf(":");
        if (idx < 0) continue;
        const key = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim();
        if (key === "user-agent") applies = value === "*" || USER_AGENT.toLowerCase().includes(value.toLowerCase());
        else if (applies && key === "disallow" && value) disallow.push(value);
      }
    }
  } catch {
    /* unreachable robots.txt = no restrictions declared */
  }
  robotsCache.set(origin, { at: Date.now(), disallow });
  return disallow;
}

export type FetchedPage = { url: string; status: number; html: string };
export type PageResult = FetchedPage | { error: string };

/**
 * Politeness: at most one request per host every FETCH_HOST_GAP_MS (default 1 s), across
 * all research workers in this process — a site is never hit in parallel bursts.
 */
const hostNext = new Map<string, number>();
async function hostSlot(hostname: string) {
  const gap = Number(process.env.FETCH_HOST_GAP_MS ?? 1000);
  if (!(gap > 0)) return;
  const now = Date.now();
  const at = Math.max(now, hostNext.get(hostname) ?? 0);
  hostNext.set(hostname, at + gap);
  if (hostNext.size > 5000) for (const [h, t] of hostNext) if (t < now) hostNext.delete(h);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

/**
 * Fetch one public page. `cache` (one research run) de-duplicates requests: the same URL is
 * fetched once even when discovery and website research both need it; failures are cached too.
 */
export async function fetchPublicPage(rawUrl: string, opts: { timeoutMs?: number; cache?: Map<string, PageResult> } = {}): Promise<PageResult> {
  const hit = opts.cache?.get(rawUrl);
  if (hit) return hit;
  const result = await fetchPublicPageUncached(rawUrl, opts);
  opts.cache?.set(rawUrl, result);
  if (!("error" in result)) opts.cache?.set(result.url, result);
  return result;
}

async function fetchPublicPageUncached(rawUrl: string, opts: { timeoutMs?: number }): Promise<PageResult> {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    return { error: "Invalid URL" };
  }
  for (let hop = 0; hop < 4; hop++) {
    if (!["http:", "https:"].includes(url.protocol)) return { error: "Unsupported protocol" };
    if (!(await isPublicHost(url.hostname))) return { error: "Address is not a public website" };
    const disallow = await robotsDisallow(url.origin);
    if (disallow.some((p) => url.pathname.startsWith(p))) return { error: "robots.txt disallows automated access" };
    let res: Response;
    await hostSlot(url.hostname);
    try {
      res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" }, redirect: "manual", signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000) });
    } catch (e) {
      return { error: e instanceof Error && e.name === "TimeoutError" ? "Timed out" : "Unreachable" };
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html")) return { error: `Not an HTML page (${res.status})` };
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (reader && total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    await reader?.cancel().catch(() => undefined);
    return { url: url.toString(), status: res.status, html: Buffer.concat(chunks).toString("utf8") };
  }
  return { error: "Too many redirects" };
}

/**
 * MX check for an email domain: true = accepts mail, false = no MX record,
 * null = could not be checked (DNS unreachable) — never reported as "no MX".
 */
export async function hasMxRecord(domain: string): Promise<boolean | null> {
  const attempt = async (resolver: { resolveMx: (d: string) => Promise<unknown[]> }) => {
    try {
      return (await resolver.resolveMx(domain)).length > 0;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "ENOTFOUND" || code === "ENODATA" || code === "NXDOMAIN") return false;
      return null; // infrastructure error (ECONNREFUSED, ETIMEOUT, …)
    }
  };
  const system = await attempt(dns);
  if (system !== null) return system;
  const fallback = new dns.Resolver({ timeout: 3000, tries: 1 });
  fallback.setServers(["1.1.1.1", "8.8.8.8"]);
  return attempt(fallback);
}
