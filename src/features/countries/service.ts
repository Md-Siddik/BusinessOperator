import "server-only";
import { z } from "zod";
import { COUNTRIES, getCountry } from "@/config/countries";
import { Country, RegistrySync, type CountryDoc, type RegistrySyncDoc } from "@/models";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { can, type Actor } from "@/lib/permissions";
import { getRegistryProvider, listProvidersForCountry } from "@/features/registry/providers";
import { summarizeProvider, type ProviderStatus, type ProviderSummary } from "@/features/registry/types";
import type { IntegrationState, Jurisdiction } from "@/config/jurisdictions";

/** Make sure every configured country has a runtime settings document. */
export async function ensureCountries() {
  await Promise.all(
    COUNTRIES.map((c, i) =>
      Country.updateOne({ code: c.code }, { $setOnInsert: { code: c.code, enabled: true, providerId: c.defaultProviderId, syncEnabled: true, backfillDays: 7, sortOrder: i } }, { upsert: true }),
    ),
  );
  // Countries left on a demo provider when demo mode is off fall back to their real provider.
  for (const c of COUNTRIES) {
    const doc = await Country.findOne({ code: c.code }).select("providerId").lean<{ providerId: string }>();
    if (doc && !getRegistryProvider(doc.providerId)) await Country.updateOne({ code: c.code }, { $set: { providerId: c.defaultProviderId } });
  }
}

/**
 * Effective integration state shown in the UI — derived honestly from the
 * jurisdiction catalogue, provider capabilities, credentials and the last sync:
 * Connected · Lookup only · Needs credentials · Needs approval · Under research ·
 * Provider error · No verified feed found (+ "connected, not synced yet").
 */
export type ConnectionState = IntegrationState | "NOT_SYNCED";

export type CountryView = {
  code: string;
  slug: string;
  name: string;
  adjective: string;
  flag: string;
  timezone: string;
  registryName: string;
  registrationNumberLabel: string;
  enabled: boolean;
  providerId: string;
  provider: ProviderSummary | null;
  /** True when the provider can list daily registrations and is configured. */
  dailyFeed: boolean;
  isDemo: boolean;
  state: ConnectionState;
  stateMessage?: string;
  syncEnabled: boolean;
  syncIntervalMinutes: number;
  backfillDays: number;
  lastSyncAt?: Date | null;
  lastSyncStatus?: string | null;
  lastSuccessAt?: Date | null;
  latestPublicationAt?: Date | null;
  jurisdiction: Jurisdiction;
};

function connectionState(doc: CountryDoc | undefined, provider: ProviderSummary | null): { state: ConnectionState; message?: string } {
  if (!provider) return { state: "UNDER_RESEARCH" };
  if (provider.catalogueState) return { state: provider.catalogueState as IntegrationState, message: provider.limitations };
  if (!provider.capabilities.supportsDailyRegistrations) return { state: provider.capabilities.supportsLookup ? "LOOKUP_ONLY" : "NO_VERIFIED_FEED", message: provider.limitations };
  if (!provider.configured) {
    const approval = provider.accessType === "AGREEMENT";
    return { state: approval ? "NEEDS_APPROVAL" : "NEEDS_CREDENTIALS", message: `${approval ? "Agreement required. " : ""}Set ${provider.requiredEnv.join(", ")} on the server.` };
  }
  const status = doc?.providerStatus as ProviderStatus | undefined;
  if (doc?.lastSyncStatus === "FAILED" || status?.state === "UNAVAILABLE") return { state: "PROVIDER_ERROR", message: status?.message ?? undefined };
  if (!doc?.lastSuccessAt) return { state: "NOT_SYNCED" };
  return { state: "CONNECTED" };
}

export async function listCountries(): Promise<CountryView[]> {
  const docs = await Country.find().lean<CountryDoc[]>();
  const byCode = new Map(docs.map((d) => [d.code, d]));
  return COUNTRIES.map((c) => {
    const doc = byCode.get(c.code);
    const providerId = doc?.providerId ?? c.defaultProviderId;
    const p = getRegistryProvider(providerId) ?? getRegistryProvider(c.defaultProviderId);
    const provider = p ? summarizeProvider(p) : null;
    const { state, message } = connectionState(doc, provider);
    return {
      code: c.code,
      slug: c.slug,
      name: c.name,
      adjective: c.adjective,
      flag: c.flag,
      timezone: c.timezone,
      registryName: c.registryName,
      registrationNumberLabel: c.registrationNumberLabel,
      enabled: doc?.enabled ?? c.defaultEnabled,
      providerId: provider?.id ?? providerId,
      provider,
      dailyFeed: !!provider?.capabilities.supportsDailyRegistrations && !!provider.configured,
      isDemo: provider?.isDemo ?? false,
      state,
      stateMessage: message,
      syncEnabled: doc?.syncEnabled ?? true,
      syncIntervalMinutes: doc?.syncIntervalMinutes ?? provider?.recommendedSyncMinutes ?? 1440,
      backfillDays: doc?.backfillDays ?? 7,
      lastSyncAt: doc?.lastSyncAt,
      lastSyncStatus: doc?.lastSyncStatus,
      lastSuccessAt: doc?.lastSuccessAt,
      latestPublicationAt: doc?.latestPublicationAt,
      jurisdiction: c.jurisdiction,
    };
  });
}

export async function getEnabledCountries() {
  return (await listCountries()).filter((c) => c.enabled);
}

export async function getCountryView(code: string) {
  return (await listCountries()).find((c) => c.code === code.toUpperCase());
}

export const updateCountrySchema = z.object({
  enabled: z.boolean().optional(),
  providerId: z.string().optional(),
  syncEnabled: z.boolean().optional(),
  syncIntervalMinutes: z.number().int().min(15).max(60 * 24 * 7).optional(),
  backfillDays: z.number().int().min(0).max(90).optional(),
});

export async function updateCountry(actor: Actor, code: string, input: unknown) {
  if (!can(actor, "settings.manage")) throw Errors.forbidden();
  const country = getCountry(code);
  if (!country) throw Errors.notFound();
  const data = updateCountrySchema.parse(input);
  if (data.providerId) {
    const provider = getRegistryProvider(data.providerId);
    if (!provider || provider.countryCode !== country.code) throw Errors.badRequest("This provider is not available for this country.");
  }
  await Country.updateOne({ code: country.code }, { $set: data }, { upsert: true });
  await audit(actor, "country.updated", { entityType: "Country", entityId: country.code, countryCode: country.code, metadata: data });
  return getCountryView(country.code);
}

export async function getCountryAdminDetails(code: string) {
  const view = await getCountryView(code);
  if (!view) throw Errors.notFound();
  const history = await RegistrySync.find({ countryCode: view.code }).sort({ startedAt: -1 }).limit(20).lean<RegistrySyncDoc[]>();
  return { country: view, providers: listProvidersForCountry(view.code), history };
}

/** Latest sync runs across countries (Data Sources page). */
export async function listSyncHistory(opts: { country?: string; limit?: number } = {}) {
  return RegistrySync.find(opts.country ? { countryCode: opts.country.toUpperCase() } : {})
    .sort({ startedAt: -1 })
    .limit(opts.limit ?? 50)
    .lean<RegistrySyncDoc[]>();
}

export async function getRunningSync(code: string) {
  return RegistrySync.findOne({ countryCode: code.toUpperCase(), status: "RUNNING", heartbeatAt: { $gte: new Date(Date.now() - 10 * 60_000) } }).lean<RegistrySyncDoc>();
}

/** Live reachability check for one country's provider (Data Sources → Check now). */
export async function checkProviderStatus(actor: Actor, code: string) {
  if (!can(actor, "registry.sync")) throw Errors.forbidden();
  const doc = await Country.findOne({ code: code.toUpperCase() }).lean<CountryDoc>();
  if (!doc) throw Errors.notFound();
  const provider = getRegistryProvider(doc.providerId);
  if (!provider) throw Errors.badRequest("No provider configured.");
  const status = await provider.checkStatus();
  await Country.updateOne({ code: doc.code }, { $set: { providerStatus: status } });
  return status;
}
