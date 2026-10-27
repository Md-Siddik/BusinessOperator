import { requireTeamPage } from "@/lib/auth/session";
import { LinkTabs, PageHeader } from "@/components/ui/data";
import { OpportunityListPage } from "@/components/opportunities/list-page";

export const metadata = { title: "Opportunities", robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * Opportunity Intelligence for team members granted "View Opportunity Intelligence":
 * read only, without the Owner's saves, notes, review, exports or Company Intelligence links.
 */
export default async function StaffOpportunitiesPage({ searchParams }: { searchParams: SP }) {
  await requireTeamPage("opportunities.view");
  const sp = await searchParams;
  const type = sp.type === "PROCUREMENT" ? "PROCUREMENT" : "HIRING";
  return (
    <OpportunityListPage
      basePath="/staff/opportunities"
      detailBase="/staff/opportunities"
      readOnly
      searchParams={sp}
      fixed={{ type }}
      header={
        <div className="space-y-4">
          <PageHeader eyebrow="Opportunity Intelligence" title="Opportunities" description="Verified hiring and service-purchasing opportunities from official employer and procurement sources. Read only." />
          <LinkTabs
            active={type}
            tabs={[
              { id: "HIRING", href: "/staff/opportunities?type=HIRING", label: "Hiring" },
              { id: "PROCUREMENT", href: "/staff/opportunities?type=PROCUREMENT", label: "Service & projects" },
            ]}
          />
        </div>
      }
      emptyHint="Records appear after the Owner's configured sources have synchronized."
    />
  );
}
