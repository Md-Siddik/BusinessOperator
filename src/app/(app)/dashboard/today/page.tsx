import { requireInternalPage } from "@/lib/auth/session";
import { resolveCountry } from "@/features/site/country-context";
import { DailyWorkspace } from "@/components/intel/daily-workspace";

export const metadata = { title: "Today's new companies" };

/** The owner's daily workspace: companies registered today in the selected country. */
export default async function TodayPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireInternalPage("companies.read");
  const sp = await searchParams;
  const ctx = await resolveCountry(typeof sp.country === "string" ? sp.country : undefined);
  return (
    <>
      {sp.denied && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900" role="alert">
          You don&apos;t have permission to open that page.
        </div>
      )}
      <DailyWorkspace actor={actor} country={ctx.code} searchParams={sp} basePath="/dashboard/today" mode="daily" />
    </>
  );
}
