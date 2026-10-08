import "server-only";
import { COUNTRIES } from "@/config/countries";
import { JURISDICTIONS } from "@/config/jurisdictions";
import { isDemoModeEnabled } from "@/lib/data-mode";
import { summarizeProvider, type CompanyRegistryProvider, type ProviderSummary } from "../types";
import { createBrregProvider } from "./brreg";
import { createCompaniesHouseProvider } from "./companies-house";
import { createCroProvider } from "./cro";
import { createCvrProvider } from "./cvr";
import { createInseeSireneProvider } from "./insee-sirene";
import { createKvkProvider } from "./kvk";
import { createMockProvider } from "./mock";
import { MOCK_PROFILES } from "./mock-data";
import { createBolagsverketProvider, createCatalogueProvider } from "./not-connected";
import { createOpenCorporatesProvider } from "./opencorporates";
import { createOpenRegisterProvider } from "./openregister";
import { createPrhProvider } from "./prh";
import { createRikProvider } from "./rik";

/**
 * Provider registry. To connect a new source:
 *   1. implement CompanyRegistryProvider (brreg.ts is the reference),
 *   2. register its factory below,
 *   3. add it to the jurisdiction's `providers` in src/config/jurisdictions.ts
 *      (first = default) or select it in Settings → Countries.
 * See docs/providers/README.md.
 */
const REAL_FACTORIES: Record<string, () => CompanyRegistryProvider> = {
  brreg: createBrregProvider,
  prh: createPrhProvider,
  cro: createCroProvider,
  "companies-house": createCompaniesHouseProvider,
  "insee-sirene": createInseeSireneProvider,
  kvk: createKvkProvider,
  rik: createRikProvider,
  openregister: createOpenRegisterProvider,
  cvr: createCvrProvider,
  bolagsverket: createBolagsverketProvider,
  // Catalogue placeholders for every jurisdiction without an adapter.
  ...Object.fromEntries(JURISDICTIONS.filter((j) => !j.providers.length).map((j) => [`catalogue-${j.code.toLowerCase()}`, () => createCatalogueProvider(j)])),
  // Commercial fallback, selectable per jurisdiction once licensed.
  ...Object.fromEntries(JURISDICTIONS.filter((j) => j.scope !== "NOT_APPLICABLE").map((j) => [`opencorporates-${j.code.toLowerCase()}`, () => createOpenCorporatesProvider(j.code)])),
};

const DEMO_FACTORIES: Record<string, () => CompanyRegistryProvider> = Object.fromEntries(COUNTRIES.filter((c) => MOCK_PROFILES[c.code]).map((c) => [`mock-${c.slug}`, () => createMockProvider(c.code)]));

const g = globalThis as unknown as { __etProviders?: Map<string, CompanyRegistryProvider>; __etTestProviders?: Map<string, CompanyRegistryProvider> };
const cache = (g.__etProviders ??= new Map());
const testProviders = (g.__etTestProviders ??= new Map());

/** Test-only hook: register an in-memory provider. Refused outside the test runner. */
export function registerTestProvider(provider: CompanyRegistryProvider) {
  if (process.env.NODE_ENV !== "test" && !process.env.VITEST) throw new Error("registerTestProvider is only available in tests");
  testProviders.set(provider.id, provider);
}

/** Resolve a provider. Demo providers resolve only while demo mode is enabled. */
export function getRegistryProvider(id: string | undefined | null): CompanyRegistryProvider | undefined {
  if (!id) return undefined;
  if (testProviders.has(id)) return testProviders.get(id);
  const factory = REAL_FACTORIES[id] ?? (isDemoModeEnabled() ? DEMO_FACTORIES[id] : undefined);
  if (!factory) return undefined;
  if (!cache.has(id)) cache.set(id, factory());
  return cache.get(id);
}

export function listProvidersForCountry(countryCode: string): ProviderSummary[] {
  const prefix = `-${countryCode.toLowerCase()}`;
  const ids = [
    ...Object.keys(REAL_FACTORIES).filter((id) => !id.startsWith("catalogue-") && !id.startsWith("opencorporates-")),
    `catalogue${prefix}`,
    `opencorporates${prefix}`,
    ...(isDemoModeEnabled() ? Object.keys(DEMO_FACTORIES) : []),
    ...testProviders.keys(),
  ];
  return ids
    .map((id) => getRegistryProvider(id))
    .filter((p): p is CompanyRegistryProvider => !!p && p.countryCode === countryCode)
    .map(summarizeProvider);
}
