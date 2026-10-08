import { requireInternalPage } from "@/lib/auth/session";
import { resolveCountry } from "@/features/site/country-context";
import { DailyWorkspace } from "@/components/intel/daily-workspace";

export const metadata = { title: "Saved leads" };

export default async function SavedLeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireInternalPage("companies.read");
  const sp = await searchParams;
  const ctx = await resolveCountry(typeof sp.country === "string" ? sp.country : undefined);
  return <DailyWorkspace actor={actor} country={ctx.code} searchParams={sp} basePath="/dashboard/leads" mode="saved" />;
}
