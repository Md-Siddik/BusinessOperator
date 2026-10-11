import { ownerMetadata } from "@/features/opportunities/metadata";
import { requireOwnerPage } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/data";
import { OpportunityListPage } from "@/components/opportunities/list-page";

export const generateMetadata = ownerMetadata("Saved opportunities");

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function SavedPage({ searchParams }: { searchParams: SP }) {
  await requireOwnerPage();
  const sp = await searchParams;
  return (
    <OpportunityListPage
      basePath="/dashboard/opportunities/saved"
      searchParams={{ activity: "all", ...sp }}
      fixed={{ saved: "yes" }}
      header={<PageHeader eyebrow="Opportunity Intelligence" title="Saved opportunities" description="Everything you saved, including opportunities that have since closed or expired. Saved records are never archived automatically." />}
      emptyHint="Save opportunities from any list or detail page."
    />
  );
}
