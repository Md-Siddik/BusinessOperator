import { ownerMetadata } from "@/features/opportunities/metadata";
import { requireOwnerPage } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/data";
import { OpportunityListPage } from "@/components/opportunities/list-page";

export const generateMetadata = ownerMetadata("Hiring intelligence");

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function HiringPage({ searchParams }: { searchParams: SP }) {
  await requireOwnerPage();
  return (
    <OpportunityListPage
      basePath="/dashboard/opportunities/hiring"
      searchParams={await searchParams}
      fixed={{ type: "HIRING" }}
      header={<PageHeader eyebrow="Opportunity Intelligence" title="Hiring intelligence" description="Job postings from employers' own careers pages and ATS boards, and from national public employment services. Aggregator records are labelled and never presented as employer posts. A job count is not a count of hiring companies." />}
      emptyHint="Hiring records come from Arbetsförmedlingen (Sweden), NAV (Norway, needs a token), France Travail (needs credentials) and the employer ATS boards / careers pages you add under Sources & settings."
    />
  );
}
