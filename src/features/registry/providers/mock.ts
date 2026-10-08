import { classifyIndustry } from "@/config/industries";
import { getCountry } from "@/config/countries";
import { slugify } from "@/lib/utils";
import type { Day } from "@/lib/dates/country-time";
import { NO_CAPABILITIES, type CompanyRegistryProvider, type FetchContext, type NormalizedCompany } from "../types";
import { MOCK_PROFILES, NACE_POOL, type CountryMockProfile } from "./mock-data";

/** Deterministic PRNG so the same day always yields the same demo companies (re-syncs update, not duplicate). */
function seededRandom(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)]!;
}

function weighted<T extends { weight: number }>(rand: () => number, list: T[]): T {
  const total = list.reduce((s, x) => s + x.weight, 0);
  let r = rand() * total;
  for (const x of list) {
    r -= x.weight;
    if (r <= 0) return x;
  }
  return list[list.length - 1]!;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

export function generateDemoCompany(countryCode: string, profile: CountryMockProfile, date: Date, index: number): NormalizedCompany {
  const rand = seededRandom(`${countryCode}-${dayKey(date)}-${index}`);
  const nace = weighted(rand, NACE_POOL);
  const industry = classifyIndustry(nace.code);
  const legal = weighted(rand, profile.legalForms);
  const root = pick(rand, profile.roots);
  const words = profile.words[industry] ?? profile.words.other ?? ["Group"];
  const word = pick(rand, words);
  const baseName = `${root} ${word}`;
  const companyName = legal.code === "ENK" || legal.code === "EF" || legal.code === "Tmi" || legal.code === "EI" ? baseName : `${baseName} ${legal.name}`;
  const city = pick(rand, profile.cities);
  const slug = slugify(baseName);

  const hasWebsite = rand() < 0.42;
  const hasEmail = hasWebsite ? rand() < 0.8 : rand() < 0.35;
  const hasPhone = rand() < 0.6;
  const domain = `${slug}.example`;
  const person = { name: `${pick(rand, profile.firstNames)} ${pick(rand, profile.lastNames)}`, role: pick(rand, profile.directorRoles), group: "Management" };
  const day = date.toISOString().slice(0, 10);

  return {
    identity: { sourceId: `${countryCode}-${dayKey(date)}-${index}`, name: companyName, registrationNumber: profile.registrationNumber(rand, date) },
    registration: { registrationDay: day, incorporationDay: day, status: profile.activeStatus, legalForm: legal.name, legalFormCode: legal.code },
    classification: { industryCode: nace.code, industryDescription: nace.description, codeSystem: "NACE Rev. 2", naceCode: nace.code, businessActivity: `${nace.description}.` },
    contact: {
      website: hasWebsite ? `https://www.${domain}` : undefined,
      email: hasEmail ? `${rand() < 0.5 ? "post" : "hello"}@${domain}` : undefined,
      phone: hasPhone ? profile.phone(rand) : undefined,
    },
    address: { business: { street: `${pick(rand, profile.streets)} ${1 + Math.floor(rand() * 120)}`, city: city.city, postalCode: city.postalCode, region: city.region } },
    people: [person],
    contactPerson: person,
    employees: rand() < 0.5 ? Math.floor(rand() * 12) : undefined,
    source: {},
  };
}

/** Demo provider for one country — opt-in (DEMO_MODE), clearly labelled, never presented as live. */
export function createMockProvider(countryCode: string): CompanyRegistryProvider {
  const country = getCountry(countryCode)!;
  const profile = MOCK_PROFILES[countryCode]!;
  return {
    id: `mock-${country.slug}`,
    countryCode,
    name: `Demo ${country.name} registry`,
    sourceName: "Demo data",
    sourceType: "DEMO",
    freshness: "UNKNOWN",
    isDemo: true,
    homepage: country.registryUrl,
    description: `Generates fictional ${country.name} registrations for development only. Never used in production unless the Owner explicitly allows demo mode.`,
    limitations: "Fictional companies on the reserved .example domain.",
    capabilities: { ...NO_CAPABILITIES, supportsDailyRegistrations: true, supportsRegistrationDate: true, supportsEmail: true, supportsPhone: true, supportsWebsite: true, supportsAddress: true, supportsIndustry: true, supportsDirectors: true },
    requiredEnv: [],
    isConfigured: () => true,
    recommendedSyncMinutes: 24 * 60,
    async getRegistrations(from: Day, to: Day, ctx: FetchContext) {
      const out: NormalizedCompany[] = [];
      const day = new Date(`${from}T00:00:00Z`);
      const end = Date.parse(`${to}T00:00:00Z`);
      while (day.getTime() <= end && out.length < ctx.limit) {
        const rand = seededRandom(`${countryCode}-count-${dayKey(day)}`);
        const weekday = day.getUTCDay();
        const [min, max] = profile.dailyRange;
        const count = weekday === 0 || weekday === 6 ? Math.floor(rand() * 2) : min + Math.floor(rand() * (max - min + 1));
        for (let i = 0; i < count && out.length < ctx.limit; i++) out.push(generateDemoCompany(countryCode, profile, new Date(day), i));
        day.setUTCDate(day.getUTCDate() + 1);
      }
      return { companies: out, complete: true };
    },
    async checkStatus() {
      return { state: "CONNECTED", message: "Demo provider", checkedAt: new Date() };
    },
  };
}
