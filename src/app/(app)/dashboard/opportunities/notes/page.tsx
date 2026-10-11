import { ownerMetadata } from "@/features/opportunities/metadata";
import { requireOwnerPage } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/data";
import { OpportunityListPage } from "@/components/opportunities/list-page";

export const generateMetadata = ownerMetadata("Research notes");

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function NotesPage({ searchParams }: { searchParams: SP }) {
  await requireOwnerPage();
  const sp = await searchParams;
  return (
    <OpportunityListPage
      basePath="/dashboard/opportunities/notes"
      searchParams={{ activity: "all", archived: "include", ...sp }}
      fixed={{ notes: "yes" }}
      header={<PageHeader eyebrow="Opportunity Intelligence" title="Research notes" description="Opportunities with your private research notes. Notes are owner-only and are never shared with CRM users unless you add the opportunity to the CRM." />}
      emptyHint="Add notes on an opportunity's detail page."
    />
  );
}
