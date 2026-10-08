import Link from "next/link";
import { FileText } from "lucide-react";
import { requireInternalPage } from "@/lib/auth/session";
import { formatDate } from "@/lib/utils/format";
import { listQuotations } from "@/features/quotations/service";
import { PageHeader } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Quotations" };

export default async function QuotationsPage() {
  const actor = await requireInternalPage("companies.read");
  const items = await listQuotations(actor);
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="CRM" title="Quotations" description="Editable drafts for manual communication. Download as HTML (print to PDF) and share them yourself — ExploreTechify never sends them." />
      {items.length ? (
        <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-ink-50 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2.5">#</th>
                <th className="px-4 py-2.5">Title</th>
                <th className="px-4 py-2.5">Company</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {items.map((q) => (
                <tr key={String(q._id)}>
                  <td className="px-4 py-2.5 tabular-nums">{q.number}</td>
                  <td className="px-4 py-2.5">
                    <Link href={`/dashboard/quotations/${q._id}`} className="font-medium text-ink-900 hover:text-brand-700 hover:underline">
                      {q.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">{q.companyId ? `${q.companyId.companyName} (${q.companyId.countryCode})` : "—"}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={q.status === "ACCEPTED" ? "success" : q.status === "DECLINED" ? "danger" : "neutral"}>{q.status.replace(/_/g, " ").toLowerCase()}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-ink-500">{formatDate(q.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={FileText} title="No quotations yet" description="Prepare one from a company profile once a service package fits." />
      )}
    </div>
  );
}
