import { ownerMetadata } from "@/features/opportunities/metadata";
import { requireOwnerPage } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/data";
import { OpportunityListPage } from "@/components/opportunities/list-page";

export const generateMetadata = ownerMetadata("Verification queue");

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function ReviewQueuePage({ searchParams }: { searchParams: SP }) {
  await requireOwnerPage();
  return (
    <OpportunityListPage
      basePath="/dashboard/opportunities/review"
      searchParams={await searchParams}
      fixed={{ label: "NEEDS_MANUAL_REVIEW", activity: "open" }}
      header={<PageHeader eyebrow="Opportunity Intelligence" title="Verification queue" description="Open opportunities with a concrete reason for manual review: aggregator source, agency poster, ATS board not linked from the employer's website, missing employer name, or repeated failed status checks. Open one to see the reasons and record your assessment." />}
      emptyHint="Nothing is waiting for manual verification."
    />
  );
}
