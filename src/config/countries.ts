import { JURISDICTIONS, type Jurisdiction } from "./jurisdictions";

/**
 * COUNTRY configuration for company intelligence, derived from the European
 * jurisdiction catalogue (src/config/jurisdictions.ts). Separate from website
 * languages: `suggestedLanguages` only proposes template defaults.
 *
 * Every jurisdiction gets a route (/dashboard/companies/{slug}); only those
 * enabled in Settings → Countries appear in the navigation. Appearing in the
 * list does not mean a feed is connected — see the integration state.
 */
export type CountryDefinition = {
  code: string;
  slug: string;
  name: string;
  flag: string;
  registryName: string;
  registryUrl: string;
  /** Provider used for new installs. Real providers only — demo providers are opt-in (DEMO_MODE). */
  defaultProviderId: string;
  /** "Norwegian companies registered today" */
  adjective: string;
  suggestedLanguages: string[];
  timezone: string;
  registrationNumberLabel: string;
  registrationNumberPattern: RegExp;
  defaultEnabled: boolean;
  jurisdiction: Jurisdiction;
};

const PATTERNS: Record<string, RegExp> = {
  NO: /^\d{9}$/,
  SE: /^\d{6}-\d{4}$/,
  DK: /^\d{8}$/,
  FI: /^\d{7}-\d$/,
  DE: /^HR[AB] \d{3,6}( [A-Z]+)?$/,
  FR: /^\d{9}$/,
  GB: /^[A-Z0-9]{8}$/,
  IE: /^\d{1,7}$/,
  NL: /^\d{8}$/,
  EE: /^\d{8}$/,
};

export const COUNTRIES: CountryDefinition[] = JURISDICTIONS.map((j) => ({
  code: j.code,
  slug: j.code.toLowerCase(),
  name: j.name,
  flag: j.flag,
  registryName: j.registry.name,
  registryUrl: j.registry.url,
  defaultProviderId: j.providers[0] ?? `catalogue-${j.code.toLowerCase()}`,
  adjective: j.adjective,
  suggestedLanguages: j.languages,
  timezone: j.timezone,
  registrationNumberLabel: j.registrationNumberLabel,
  registrationNumberPattern: PATTERNS[j.code] ?? /.+/,
  defaultEnabled: j.defaultEnabled,
  jurisdiction: j,
}));

export const ALL_COUNTRIES_SLUG = "all";
export const COUNTRY_CODES = COUNTRIES.map((c) => c.code);

export function getCountry(codeOrSlug: string | undefined | null): CountryDefinition | undefined {
  if (!codeOrSlug) return undefined;
  const v = codeOrSlug.toLowerCase();
  return COUNTRIES.find((c) => c.slug === v || c.code.toLowerCase() === v);
}

export function countryName(code: string | undefined | null) {
  return getCountry(code)?.name ?? code ?? "—";
}
