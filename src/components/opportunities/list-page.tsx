import { Download, SearchX } from "lucide-react";
import type { ReactNode } from "react";
import { getActor } from "@/lib/auth/session";
import { listOpportunities } from "@/features/opportunities/service";
import type { OpportunityType } from "@/features/opportunities/constants";
import { Card } from "@/components/ui/card";
import { Pagination, withParams } from "@/components/ui/data";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { buttonClasses } from "@/components/ui/button";
import { OpportunityFilters } from "./filters";
import { OpportunityTable, type OpportunityRow } from "./opportunity-table";

type SP = Record<string, string | string[] | undefined>;

function flat(sp: SP): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
}

/**
 * Server-rendered, server-filtered, paginated opportunity list (shared by Hiring,
 * Service & Project, Verification queue, Saved, Notes). `fixed` params cannot be changed by the URL.
 */
export async function OpportunityListPage({ basePath, searchParams, fixed = {}, emptyHint, header }: { basePath: string; searchParams: SP; fixed?: Record<string, string>; emptyHint?: ReactNode; header?: ReactNode }) {
  const actor = await getActor();
  const params = flat(searchParams);
  const input = { ...params, ...fixed };
  const res = await listOpportunities(actor, input, { lenient: true });
  const rows = JSON.parse(JSON.stringify(res.items)) as OpportunityRow[];
  const exportHref = withParams("/api/opportunities/export", input, { page: undefined, pageSize: undefined });
  return (
    <div className="space-y-4">
      {header}
      {res.ignored.length > 0 && (
        <Alert tone="warning" title="Some filters were ignored">
          Unsupported value for: {res.ignored.join(", ")}. The list below is shown without those filters.
        </Alert>
      )}
      <OpportunityFilters basePath={basePath} params={params} fixedType={fixed.type as OpportunityType | undefined} dateDescription={res.dateWindow?.description} />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
          <p className="text-sm text-ink-600">
            <span className="font-semibold text-ink-900">{res.total.toLocaleString("en-GB")}</span> opportunit{res.total === 1 ? "y" : "ies"} · canonical records only (duplicates folded)
          </p>
          {res.total > 0 && (
            <a href={exportHref} className={buttonClasses("outline", "sm")}>
              <Download className="h-4 w-4" aria-hidden /> Export CSV
            </a>
          )}
        </div>
        {rows.length ? (
          <OpportunityTable rows={rows} />
        ) : (
          <EmptyState icon={SearchX} title="No verified opportunities available for this filter yet." description={emptyHint ?? "Records appear only after a configured source has been synchronized. Check Sources & integrations for each provider's status."} />
        )}
        <Pagination page={res.page} pageCount={res.pageCount} total={res.total} buildHref={(p) => withParams(basePath, params, { page: p })} />
      </Card>
    </div>
  );
}
