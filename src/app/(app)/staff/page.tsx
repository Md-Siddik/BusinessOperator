import { requireStaffPage } from "@/lib/auth/session";
import { formatDate } from "@/lib/utils/format";
import { getClientSummary } from "@/features/clients/summary";
import { PageHeader } from "@/components/ui/data";
import { ClientSummarySection } from "@/components/workspace/client-summary";

export const metadata = { title: "Overview" };

/** Staff workspace home: client details and what needs a reply. */
export default async function StaffHome({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const actor = await requireStaffPage();
  const { denied } = await searchParams;
  const summary = await getClientSummary(actor);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={formatDate(new Date(), "EEEE d MMMM yyyy")} title={`Hello, ${actor.name.split(" ")[0]}`} description="Client accounts, messages, requests and website content you maintain." />
      {denied && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900" role="alert">
          You don&apos;t have permission to open that page. Ask the owner if you need access.
        </div>
      )}
      <ClientSummarySection summary={summary} base="/staff" />
    </div>
  );
}
