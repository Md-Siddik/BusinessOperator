import { notFound } from "next/navigation";
import { getCountry } from "@/config/countries";
import { requireInternalPage } from "@/lib/auth/session";
import { getEnabledCountries } from "@/features/countries/service";
import { DailyWorkspace } from "@/components/intel/daily-workspace";

export async function generateMetadata({ params }: { params: Promise<{ country: string }> }) {
  const { country } = await params;
  const c = getCountry(country);
  return { title: country === "all" ? "Old company Intelligence — all countries" : c ? `${c.name} — old company Intelligence` : "Old company Intelligence" };
}

/**
 * Old company Intelligence: the same Company Intelligence workspace (table, contacts, filters,
 * company profiles, Send to Marketer), limited to companies registered at least 6 months ago that
 * the registry still lists as active. Every registration date by default.
 */
export default async function OldCompaniesCountryPage({ params, searchParams }: { params: Promise<{ country: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireInternalPage("companies.read");
  const { country } = await params;
  const sp = await searchParams;
  const code = country === "all" ? "ALL" : getCountry(country)?.code;
  if (!code) notFound();
  if (code !== "ALL" && !(await getEnabledCountries()).some((c) => c.code === code)) notFound();
  const name = code === "ALL" ? "All countries" : getCountry(code)!.name;
  return <DailyWorkspace actor={actor} country={code} searchParams={sp} basePath={`/dashboard/old-companies/${country}`} mode="research" fixedPath variant="old" title={`${name} — operating companies registered 6+ months ago`} />;
}
