import { ownerMetadata } from "@/features/opportunities/metadata";
import { requireOwnerPage } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/data";
import { OpportunityListPage } from "@/components/opportunities/list-page";

export const generateMetadata = ownerMetadata("Service & project opportunities");

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function ProcurementPage({ searchParams }: { searchParams: SP }) {
  await requireOwnerPage();
  return (
    <OpportunityListPage
      basePath="/dashboard/opportunities/procurement"
      searchParams={await searchParams}
      fixed={{ type: "PROCUREMENT" }}
      header={<PageHeader eyebrow="Opportunity Intelligence" title="Service & project opportunities" description="Published calls for tender and requests for proposals from official procurement portals (TED, Find a Tender, Contracts Finder, BOAMP). Only explicit published requests appear here — a weak website is never treated as a purchase request." />}
      emptyHint="Procurement records come from TED (NO, SE, DK, FI, DE, FR — above EU thresholds), Find a Tender and Contracts Finder (UK) and BOAMP (France). Check their status under Sources & settings."
    />
  );
}
