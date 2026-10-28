import { notFound } from "next/navigation";
import { getCountry } from "@/config/countries";
import { requireInternalPage } from "@/lib/auth/session";
import { getEnabledCountries } from "@/features/countries/service";
import { OldCompanyWorkspace } from "@/components/intel/old-company-workspace";

export async function generateMetadata({ params }: { params: Promise<{ country: string }> }) {
  const { country } = await params;
  const c = getCountry(country);
  return { title: country === "all" ? "Old company Intelligence — all countries" : c ? `${c.name} — old company Intelligence` : "Old company Intelligence" };
}

/**
 * Old company Intelligence: established businesses from its own dataset (historical registry
 * records, collected separately). Independent of Startup Company Intelligence — no shared query,
 * no shared records, no fallback to startup data.
 */
export default async function OldCompaniesCountryPage({ params, searchParams }: { params: Promise<{ country: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireInternalPage("companies.read");
  const { country } = await params;
  const sp = await searchParams;
  const code = country === "all" ? "ALL" : getCountry(country)?.code;
  if (!code) notFound();
  if (code !== "ALL" && !(await getEnabledCountries()).some((c) => c.code === code)) notFound();
  return <OldCompanyWorkspace actor={actor} country={code} searchParams={sp} />;
}
