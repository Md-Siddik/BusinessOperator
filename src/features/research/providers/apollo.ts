import "server-only";
import { createHttpClient, ProviderHttpError } from "@/features/registry/http";

/**
 * Apollo — Organization Enrichment only (no sequences / sending).
 * Docs: https://docs.apollo.io/reference/organization-enrichment
 *   GET https://api.apollo.io/api/v1/organizations/enrich?domain=…   header x-api-key
 * Call only with a CONFIRMED domain. A response without a phone does not complete phone research.
 */
const http = createHttpClient({ name: "Apollo", minIntervalMs: 1_000, timeoutMs: 20_000, maxRetries: 2 });

export function apolloKey() {
  return process.env.APOLLO_API_KEY || "";
}

export type ApolloOrganization = {
  name?: string;
  website_url?: string;
  primary_domain?: string;
  phone?: string;
  sanitized_phone?: string;
  primary_phone?: { number?: string; source?: string; sanitized_number?: string };
  linkedin_url?: string;
  founded_year?: number;
  raw_address?: string;
  country?: string;
};

export async function apolloEnrichOrganization(domain: string, name?: string) {
  const q = new URLSearchParams({ domain, ...(name && { name }) });
  const res = await http.request(`https://api.apollo.io/api/v1/organizations/enrich?${q}`, { headers: { "x-api-key": apolloKey(), "Cache-Control": "no-cache" } });
  if (res.status === 429) throw new ProviderHttpError("Apollo rate limit / credits exhausted", 429, true);
  if (res.status === 401 || res.status === 403) throw new ProviderHttpError("Apollo rejected the API key", res.status);
  if (res.status === 404) return null;
  if (!res.ok) throw new ProviderHttpError(`Apollo responded ${res.status}`, res.status, true);
  return ((await res.json()) as { organization?: ApolloOrganization }).organization ?? null;
}
