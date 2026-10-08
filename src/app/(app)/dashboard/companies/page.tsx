import { requireInternalPage } from "@/lib/auth/session";
import { resolveCountry } from "@/features/site/country-context";
import { DailyWorkspace } from "@/components/intel/daily-workspace";

export const metadata = { title: "All companies" };

/** Research view: every stored company, any registration date, with country/date/contact filters. */
export default async function CompaniesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireInternalPage("companies.read");
  const sp = await searchParams;
  const ctx = await resolveCountry(typeof sp.country === "string" ? sp.country : undefined);
  return <DailyWorkspace actor={actor} country={ctx.code} searchParams={sp} basePath="/dashboard/companies" mode="research" title="All companies" />;
}
