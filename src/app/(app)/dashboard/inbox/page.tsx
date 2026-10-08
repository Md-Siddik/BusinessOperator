import Link from "next/link";
import { Inbox } from "lucide-react";
import { requireInternalPage } from "@/lib/auth/session";
import { formatRelative } from "@/lib/utils/format";
import { InboxItem, type InboxItemDoc } from "@/models";
import { PageHeader } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { InboxActions } from "@/components/intel/inbox-actions";

export const metadata = { title: "Research inbox" };

const TYPE_LABELS: Record<string, string> = { NEW_CONTACTABLE: "Newly contactable", VERIFICATION_CHANGE: "Verification change", SERVICE_MATCH: "Service match", REVIEW_NEEDED: "Needs review", SOURCE_ISSUE: "Source issue" };

/** Newly contactable companies, verification changes, strong service matches and review needs (deduplicated). */
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  await requireInternalPage("companies.read");
  const { archived } = await searchParams;
  const items = await InboxItem.find({ archivedAt: archived ? { $ne: null } : null }).sort({ readAt: 1, priority: -1, createdAt: -1 }).limit(200).populate("companyId", "countryCode").lean<(InboxItemDoc & { companyId?: { _id: string; countryCode: string } | null })[]>();
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Research"
        title="Research inbox"
        description="Companies that just became contactable, important verification changes, strong service matches and contacts waiting for review. Volume is controlled in Settings → Research."
        actions={
          <Link href={archived ? "/dashboard/inbox" : "/dashboard/inbox?archived=1"} className="text-sm text-brand-700 hover:underline">
            {archived ? "Show open items" : "Show archived"}
          </Link>
        }
      />
      {items.length ? (
        <ul className="divide-y divide-ink-100 rounded-xl border border-ink-200 bg-white">
          {items.map((i) => (
            <li key={String(i._id)} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  {!i.readAt && <span className="h-2 w-2 rounded-full bg-brand-600" aria-label="Unread" />}
                  <Badge tone={i.type === "NEW_CONTACTABLE" ? "success" : i.type === "REVIEW_NEEDED" ? "warning" : "brand"}>{TYPE_LABELS[i.type]}</Badge>
                  {i.companyId ? (
                    <Link href={`/dashboard/companies/${i.companyId.countryCode.toLowerCase()}/${i.companyId._id}`} className="font-medium text-ink-900 hover:text-brand-700 hover:underline">
                      {i.title}
                    </Link>
                  ) : (
                    <span className="font-medium text-ink-900">{i.title}</span>
                  )}
                  {i.countryCode && <span className="text-xs text-ink-500">{i.countryCode}</span>}
                </p>
                {i.body && <p className="mt-0.5 text-sm text-ink-600">{i.body}</p>}
                <p className="text-xs text-ink-400">{formatRelative(i.createdAt)}</p>
              </div>
              {!archived && <InboxActions id={String(i._id)} read={!!i.readAt} />}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Inbox} title="Nothing here" description="New items appear when research finds a usable contact, a verification result changes or a strong service match appears." />
      )}
    </div>
  );
}
