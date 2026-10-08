import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getCountry } from "@/config/countries";
import { getEnabledCountries } from "@/features/countries/service";

/** Resolve a /dashboard/companies/[country] segment ("no", "se", … or "all"). Disabled countries 404. */
export async function countryFromSegment(segment: string) {
  const countries = await getEnabledCountries();
  if (segment.toLowerCase() === "all") return { code: "ALL", name: "All Countries", flag: "🌍", view: undefined, countries };
  const def = getCountry(segment);
  const view = countries.find((c) => c.code === def?.code);
  if (!def || !view) notFound();
  return { code: def.code, name: def.name, flag: def.flag, view, countries };
}

export async function rememberCountry(code: string) {
  try {
    const jar = await cookies();
    jar.set("et_country", code, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  } catch {
    /* cookies are read-only during render; the client switcher persists the choice */
  }
}
