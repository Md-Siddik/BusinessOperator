import { cookies } from "next/headers";
import { getEnabledCountries, type CountryView } from "@/features/countries/service";

export const COUNTRY_COOKIE = "et_country";

/**
 * Dashboard country context. Resolution order: explicit ?country= → remembered
 * cookie → first enabled country with a connected daily feed → first enabled
 * country. "ALL" is only ever an explicit choice — the default view is always a single country.
 */
export async function resolveCountry(param?: string | null): Promise<{ code: string; countries: CountryView[]; country?: CountryView }> {
  const countries = await getEnabledCountries();
  const jar = await cookies();
  const candidates = [param, jar.get(COUNTRY_COOKIE)?.value].filter(Boolean).map((c) => c!.toUpperCase());
  for (const c of candidates) {
    if (c === "ALL") return { code: "ALL", countries };
    const match = countries.find((x) => x.code === c);
    if (match) return { code: match.code, countries, country: match };
  }
  const first = countries.find((c) => c.dailyFeed) ?? countries[0];
  return { code: first?.code ?? "ALL", countries, country: first };
}
