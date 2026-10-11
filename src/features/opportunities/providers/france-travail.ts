import "server-only";
import { createHttpClient, ProviderHttpError } from "@/features/registry/http";
import { cleanUrl, normalizeRegNumber, parseSourceDate, truncate } from "../normalize";
import type { ActivityCheckResult, FetchContext, FetchResult, NormalizedContact, NormalizedOpportunity, OpportunityProvider } from "./types";

/**
 * France — France Travail "Offres d'emploi v2" (official public employment service API).
 * Access: free registration on francetravail.io → application → subscribe to the API →
 * OAuth2 client credentials (realm /partenaire, scope api_offresdemploiv2 o2dsoffre).
 *   token  POST https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire
 *   search GET  https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search
 *          (minCreationDate / maxCreationDate, range=a-b; at most 150 per page, 1150 per query)
 *   one    GET  …/offres/{id}
 * Built from documentation; not yet exercised with real credentials (none available during build).
 */
const TOKEN_URL = "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
const API = "https://api.francetravail.io/partenaire/offresdemploi/v2";
const http = createHttpClient({ name: "France Travail Offres d'emploi", minIntervalMs: 120, timeoutMs: 30_000 });

type Offre = {
  id: string;
  intitule?: string;
  description?: string;
  dateCreation?: string;
  dateActualisation?: string;
  lieuTravail?: { libelle?: string; commune?: string };
  romeCode?: string;
  romeLibelle?: string;
  appellationlibelle?: string;
  entreprise?: { nom?: string; url?: string; siret?: string };
  typeContratLibelle?: string;
  contact?: { nom?: string; coordonnees1?: string; courriel?: string; telephone?: string; urlPostulation?: string; urlRecruteur?: string };
  origineOffre?: { origine?: string; urlOrigine?: string; partenaires?: { nom?: string; url?: string }[] };
  secteurActiviteLibelle?: string;
};

const g = globalThis as unknown as { __etFtToken?: { value: string; exp: number } };

function creds() {
  return { id: process.env.FRANCE_TRAVAIL_CLIENT_ID?.trim(), secret: process.env.FRANCE_TRAVAIL_CLIENT_SECRET?.trim() };
}

async function accessToken(signal?: AbortSignal) {
  if (g.__etFtToken && g.__etFtToken.exp > Date.now() + 30_000) return g.__etFtToken.value;
  const { id, secret } = creds();
  if (!id || !secret) throw new Error("France Travail credentials are not set.");
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret, scope: "api_offresdemploiv2 o2dsoffre" });
  const res = await http.request(TOKEN_URL, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal });
  if (!res.ok) throw new ProviderHttpError(`France Travail token request failed (${res.status}). Check FRANCE_TRAVAIL_CLIENT_ID / SECRET and the API subscription.`, res.status);
  const t = (await res.json()) as { access_token: string; expires_in?: number };
  g.__etFtToken = { value: t.access_token, exp: Date.now() + (t.expires_in ?? 1200) * 1000 };
  return t.access_token;
}

/** France Travail expects ISO-8601 UTC without milliseconds. */
const iso = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;

function normalize(o: Offre): NormalizedOpportunity {
  const contacts: NormalizedContact[] = [];
  if (o.contact?.nom || o.contact?.courriel || o.contact?.telephone) contacts.push({ kind: o.contact.nom ? "NAMED_PERSON" : "APPLICATION_EMAIL", name: o.contact.nom, email: o.contact.courriel, phone: o.contact.telephone });
  if (o.entreprise?.url) contacts.push({ kind: "ORGANIZATION_WEBSITE", url: cleanUrl(o.entreprise.url) });
  const applyUrl = cleanUrl(o.contact?.urlPostulation);
  if (applyUrl) contacts.push({ kind: "APPLICATION_LINK", url: applyUrl });
  const siret = normalizeRegNumber(o.entreprise?.siret);
  // Offers relayed from partner job boards are third-party routes, not employer postings.
  const viaPartner = (o.origineOffre?.partenaires?.length ?? 0) > 0;
  return {
    externalId: o.id,
    type: "HIRING",
    title: o.intitule ?? "(sans titre)",
    organization: { name: o.entreprise?.nom, registrationNumber: siret ? siret.slice(0, 9) : undefined, registrationCountry: "FR", website: cleanUrl(o.entreprise?.url) },
    countryCode: "FR",
    location: o.lieuTravail?.libelle,
    summary: truncate(o.description, 4000),
    sourceUrl: cleanUrl(o.origineOffre?.urlOrigine) ?? `https://candidat.francetravail.fr/offres/recherche/detail/${encodeURIComponent(o.id)}`,
    applyUrl,
    thirdPartyUrl: viaPartner ? cleanUrl(o.origineOffre?.partenaires?.[0]?.url) : undefined,
    sourceClass: viaPartner ? "THIRD_PARTY_AGGREGATOR" : "OFFICIAL_PUBLIC_EMPLOYMENT_SERVICE",
    sourcePublisher: viaPartner ? `France Travail (relayed from ${o.origineOffre?.partenaires?.[0]?.nom ?? "a partner board"})` : "France Travail",
    publishedAt: parseSourceDate(o.dateCreation),
    sourceUpdatedAt: parseSourceDate(o.dateActualisation),
    sourceSaysActive: true,
    jobCategory: o.appellationlibelle ?? o.romeLibelle,
    employmentType: o.typeContratLibelle,
    classification: { scheme: "ROME", codes: o.romeCode ? [o.romeCode] : undefined, labels: o.romeLibelle ? [o.romeLibelle] : undefined },
    contacts,
  };
}

export const franceTravailProvider: OpportunityProvider = {
  id: "france-travail",
  name: "France Travail — Offres d'emploi v2",
  publisher: "France Travail (French public employment service)",
  type: "HIRING",
  defaultSourceClass: "OFFICIAL_PUBLIC_EMPLOYMENT_SERVICE",
  perEmployer: false,
  coverage: [{ code: "FR", level: "NATIONAL_OFFICIAL", note: "Offers published on France Travail, including offers relayed from partner boards (classified as third-party)." }],
  access: {
    type: "OAUTH_CLIENT",
    requiredEnv: ["FRANCE_TRAVAIL_CLIENT_ID", "FRANCE_TRAVAIL_CLIENT_SECRET"],
    signupUrl: "https://francetravail.io/data/api/offres-emploi",
    termsUrl: "https://francetravail.io/data/api/offres-emploi",
    termsNote: "Free registration on francetravail.io; subscribe the application to “API Offres d'emploi”. Respect the API's conditions of use.",
  },
  docsUrl: "https://francetravail.io/data/api/offres-emploi",
  homepage: "https://www.francetravail.fr",
  description: "French job offers with employer name and SIRET (when published), ROME occupation, contract type and application route.",
  limitations: "Built from documentation, not yet tested with real credentials. Each query returns at most 1 150 offers, so runs are split into time windows. Many offers do not publish the employer (anonymous offers).",
  capabilities: { incremental: true, pagination: true, publishedAt: true, updatedAt: true, deadline: false, removalDetection: "NONE", activityCheck: true, employerIdentity: "REGISTRATION_NUMBER", contacts: true, webhooks: false, directApplyLink: false },
  evidence: "DOCUMENTED_NOT_TESTED",
  freshnessNote: "Polled by creation date windows; not real-time.",
  recommendedIntervalMinutes: 60,
  settingFields: [
    { key: "keywords", label: "Keywords (motsCles)", kind: "text", defaultValue: "", help: "Optional comma-separated keywords to narrow the scope." },
    { key: "codeROME", label: "ROME codes", kind: "list", defaultValue: "M1805, M1806, M1810, M1802, M1801", help: "ROME occupation codes (default: IT / digital occupations). Empty = all offers (very large volume)." },
    { key: "initialDays", label: "Initial backfill (days)", kind: "number", defaultValue: 3, help: "How far back the first run reads." },
  ],
  isConfigured: () => {
    const { id, secret } = creds();
    const missing = [...(id ? [] : ["FRANCE_TRAVAIL_CLIENT_ID"]), ...(secret ? [] : ["FRANCE_TRAVAIL_CLIENT_SECRET"])];
    return { ok: missing.length === 0, missing, message: missing.length ? "Needs francetravail.io application credentials." : undefined };
  },
  async fetch(ctx: FetchContext): Promise<FetchResult> {
    const token = await accessToken(ctx.signal);
    const now = new Date();
    const days = Math.min(Math.max(Number(ctx.feed.settings.initialDays ?? 3), 1), 14);
    const from = ctx.cursor ? new Date(new Date(ctx.cursor).getTime() - 5 * 60_000) : new Date(now.getTime() - days * 86_400_000);
    const rome = String(ctx.feed.settings.codeROME ?? "M1805, M1806, M1810, M1802, M1801").split(/[,\s]+/).filter(Boolean).join(",");
    const items: NormalizedOpportunity[] = [];
    let complete = true;
    // Windows of at most 12 h keep each query under the 1 150-result cap in normal volumes.
    let windowEnd = from;
    while (windowEnd < now) {
      const windowStart = windowEnd;
      windowEnd = new Date(Math.min(now.getTime(), windowStart.getTime() + 12 * 3_600_000));
      for (let start = 0; start < 1150; start += 150) {
        if (items.length >= ctx.limit) {
          complete = false;
          break;
        }
        const q = new URLSearchParams({ minCreationDate: iso(windowStart), maxCreationDate: iso(windowEnd), range: `${start}-${start + 149}` });
        if (rome) q.set("codeROME", rome);
        if (ctx.feed.settings.keywords) q.set("motsCles", String(ctx.feed.settings.keywords));
        const res = await http.request(`${API}/offres/search?${q}`, { headers: { Authorization: `Bearer ${token}` }, signal: ctx.signal });
        if (res.status === 204) break;
        if (!res.ok && res.status !== 206) throw new ProviderHttpError(`France Travail search responded ${res.status}`, res.status, res.status >= 500);
        const data = (await res.json()) as { resultats?: Offre[] };
        const batch = data.resultats ?? [];
        items.push(...batch.map(normalize));
        if (batch.length < 150) break;
      }
      if (!complete) break;
    }
    return { items, complete, cursor: complete ? now.toISOString() : ctx.cursor ?? null };
  },
  async checkActivity(item): Promise<ActivityCheckResult> {
    try {
      const token = await accessToken();
      const res = await http.request(`${API}/offres/${encodeURIComponent(item.externalId)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 404) return { status: "REMOVED", detail: "France Travail reports the offer was not found (404)." };
      if (res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return res.status === 204 ? { status: "UNKNOWN", detail: "France Travail returned no content for the offer." } : { status: "ACTIVE", detail: "Offer is published on France Travail." };
      }
      return { status: "UNKNOWN", detail: `France Travail responded ${res.status}.`, failed: true };
    } catch (e) {
      return { status: "UNKNOWN", detail: e instanceof Error ? e.message : "Status check failed", failed: true };
    }
  },
};
