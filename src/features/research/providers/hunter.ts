import "server-only";
import { createHttpClient, ProviderHttpError } from "@/features/registry/http";

/**
 * Hunter — contact-DATA endpoints only (no sending / sequences / campaigns).
 * Docs: https://hunter.io/api-documentation/v2
 *   GET /v2/domain-search   — sourced emails for a confirmed domain
 *   GET /v2/email-verifier  — deliverability assessment
 *   GET /v2/domain-finder   — BETA: candidate domains for a company name (never trusted without identity checks)
 * Auth: X-API-KEY header. Hunter's documented "test-api-key" returns dummy data and is refused.
 */
const BASE = "https://api.hunter.io/v2";
const http = createHttpClient({ name: "Hunter", minIntervalMs: 250, timeoutMs: 20_000, maxRetries: 2 });

export function hunterKey() {
  const k = process.env.HUNTER_API_KEY || "";
  if (!k || k === "test-api-key") return "";
  return k;
}

async function get<T>(path: string, params: Record<string, string | number | undefined>) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
  const res = await http.request(`${BASE}${path}?${q}`, { headers: { "X-API-KEY": hunterKey() } });
  if (res.status === 429) throw new ProviderHttpError("Hunter rate limit / quota reached", 429, true);
  if (res.status === 401 || res.status === 403) throw new ProviderHttpError("Hunter rejected the API key", res.status);
  if (res.status === 404) return null;
  if (!res.ok) throw new ProviderHttpError(`Hunter responded ${res.status}`, res.status, true);
  return ((await res.json()) as { data: T }).data;
}

export type HunterEmail = {
  value: string;
  type?: "generic" | "personal";
  confidence?: number;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  phone_number?: string | null;
  sources?: { domain: string; uri: string; extracted_on?: string; last_seen_on?: string; still_on_page?: boolean }[];
  verification?: { date?: string | null; status?: string | null };
};

export async function hunterDomainSearch(domain: string) {
  return get<{ domain: string; organization?: string | null; pattern?: string | null; accept_all?: boolean; emails: HunterEmail[] }>("/domain-search", { domain, limit: 10 });
}

export type HunterVerification = { status: "valid" | "invalid" | "accept_all" | "webmail" | "disposable" | "unknown"; score?: number; email: string };
export async function hunterVerifyEmail(email: string) {
  return get<HunterVerification>("/email-verifier", { email });
}

/** BETA endpoint — results are candidates only. */
export async function hunterDomainFinder(company: string) {
  return get<{ domain: string; company_name?: string; email_count?: number }[] | { domain: string; company_name?: string }>("/domain-finder", { company, limit: 5 });
}

/** Map Hunter verifier status to our email verification vocabulary. */
export function mapHunterStatus(status: HunterVerification["status"]) {
  switch (status) {
    case "valid":
      return "DELIVERABLE" as const;
    case "invalid":
      return "INVALID" as const;
    case "accept_all":
      return "CATCH_ALL" as const;
    default:
      return "UNKNOWN" as const; // webmail / disposable / unknown are not proof of a working mailbox
  }
}
