import "server-only";
import { createHttpClient, ProviderHttpError } from "@/features/registry/http";

/**
 * Brave Search API — web search used to find candidate official websites or
 * company-operated business pages. Results are LEADS, never proof of ownership:
 * every candidate page is fetched and must show the registration number or exact name.
 * Docs: https://api-dashboard.search.brave.com/app/documentation/web-search/get-started
 */
const http = createHttpClient({ name: "Brave Search", minIntervalMs: 1_100, timeoutMs: 15_000, maxRetries: 2 });

export function braveKey() {
  return process.env.BRAVE_SEARCH_API_KEY || "";
}

export type BraveResult = { title: string; url: string; description?: string };

export async function braveWebSearch(q: string, opts: { country?: string; lang?: string; count?: number } = {}) {
  const params = new URLSearchParams({ q, count: String(opts.count ?? 10) });
  if (opts.country) params.set("country", opts.country.toLowerCase());
  if (opts.lang) params.set("search_lang", opts.lang);
  const res = await http.request(`https://api.search.brave.com/res/v1/web/search?${params}`, { headers: { "X-Subscription-Token": braveKey(), Accept: "application/json" } });
  if (res.status === 429) throw new ProviderHttpError("Brave Search rate limit / quota reached", 429, true);
  if (res.status === 401 || res.status === 403) throw new ProviderHttpError("Brave Search rejected the API key", res.status);
  if (!res.ok) throw new ProviderHttpError(`Brave Search responded ${res.status}`, res.status, true);
  const data = (await res.json()) as { web?: { results?: BraveResult[] } };
  return data.web?.results ?? [];
}
