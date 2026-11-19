import "server-only";
import { Country, Company, type CountryDoc } from "@/models";
import { getCountry } from "@/config/countries";
import { eachDay, resolveDayRange, todayIn } from "@/lib/dates/country-time";
import { getRegistryProvider } from "./providers";
import { transientRow, transientRows } from "@/lib/db/transient-registry";

const active = new Map<string, Promise<void>>();
const loaded = new Map<string, number>();

/** Request-scoped source loading, deduplicated briefly within this process only. */
export async function loadRegistryWindow(country: string, range = "all", from?: string, to?: string, force = false) {
  const countries = await Country.find({ enabled: true, ...(country.toUpperCase() === "ALL" ? { lastSuccessAt: { $ne: null } } : { code: country.toUpperCase() }) }).lean<CountryDoc[]>();
  await Promise.all(countries.map(async c => {
    const def = getCountry(c.code);
    const provider = getRegistryProvider(c.providerId);
    if (!def || !provider?.getRegistrations || !provider.isConfigured()) return;
    const window = resolveDayRange(def.timezone, range, from, to);
    // With no date bound, use the same most recent incremental window as manual sync.
    const end = window.to ?? todayIn(def.timezone);
    const start = window.from ?? new Date(Date.parse(`${end}T00:00:00Z`) - Math.max(1, c.backfillDays ?? 7, provider.lookbackDays ?? 1) * 86400000).toISOString().slice(0, 10);
    const key = `${c.code}:${start}:${end}`;
    const availableDays = new Set(transientRows(Company.collection.name).filter(row => row.countryCode === c.code).map(row => row.registrationDay));
    if (!force && eachDay(start, end).every(day => availableDays.has(day))) return;
    // Legacy/manual datasets retain the existing explicit Sync workflow until their first source sync.
    if (!force && !c.lastSuccessAt && await Company.collection.countDocuments({ countryCode: c.code })) return;
    if (!force && (loaded.get(key) ?? 0) > Date.now()) return;
    if (!active.has(key)) active.set(key, (async () => {
      const batch = await provider.getRegistrations!(start, end, { limit: Number(process.env.REGISTRY_MAX_PER_RUN || provider.recommendedBatchLimit || 5000), signal: AbortSignal.timeout(120_000) });
      const { ingestCompanies, rebuildSnapshots } = await import("./sync");
      await ingestCompanies(provider, c.code, batch.companies);
      await rebuildSnapshots(c.code, start, end, { providerId: provider.id, isDemo: provider.isDemo, complete: batch.complete, sourceTotal: start === end ? batch.total : undefined });
      await Country.updateOne({ code: c.code }, { $set: { lastSyncAt: new Date(), lastSuccessAt: new Date(), lastSyncStatus: batch.complete ? "SUCCESS" : "PARTIAL", providerStatus: { state: "CONNECTED", checkedAt: new Date() } } });
      for (const [cached, expires] of loaded) if (expires < Date.now()) loaded.delete(cached);
      loaded.set(key, Date.now() + 60_000);
    })().finally(() => active.delete(key)));
    try { await active.get(key); }
    catch (error) {
      loaded.set(key, Date.now() + 30_000);
      console.error("[registry.request] Source unavailable", { country: c.code, error: error instanceof Error ? error.name : "UnknownError" });
    }
  }));
}

export async function reloadTransientCompany(id: string) {
  if (transientRow(Company.collection.name, id)) return;
  if (!/^[a-f\d]{24}$/i.test(id)) return;
  const country = Buffer.from(id.slice(0, 4), "hex").toString();
  const raw = id.slice(4, 12);
  if (!getCountry(country) || !/^\d{8}$/.test(raw)) return;
  const day = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  if (Number.isNaN(Date.parse(day)) || day < "1900-01-01") return;
  await loadRegistryWindow(country, "custom", day, day, true);
}
