import { notFound } from "next/navigation";
import { getCountry } from "@/config/countries";
import { requireInternalPage } from "@/lib/auth/session";
import { getEnabledCountries } from "@/features/countries/service";
import { DailyWorkspace } from "@/components/intel/daily-workspace";

export async function generateMetadata({ params }: { params: Promise<{ country: string }> }) {
  const { country } = await params;
  const c = getCountry(country);
  return { title: country === "all" ? "All countries — new registrations" : c ? `${c.name} — new registrations` : "Companies" };
}

/** Country dashboard: defaults to companies registered today in that country. */
export default async function CountryPage({ params, searchParams }: { params: Promise<{ country: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireInternalPage("companies.read");
  const { country } = await params;
  const sp = await searchParams;
  const code = country === "all" ? "ALL" : getCountry(country)?.code;
  if (!code) notFound();
  if (code !== "ALL" && !(await getEnabledCountries()).some((c) => c.code === code)) notFound();
  return <DailyWorkspace actor={actor} country={code} searchParams={sp} basePath={`/dashboard/companies/${country}`} mode="daily" fixedPath />;
}
