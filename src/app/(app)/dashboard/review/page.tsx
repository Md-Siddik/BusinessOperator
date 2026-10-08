import Link from "next/link";
import { ShieldQuestion } from "lucide-react";
import { requireInternalPage } from "@/lib/auth/session";
import { CONTACT_OWNERSHIP_LABELS, type ContactOwnership, type ContactSourceKind } from "@/lib/company-fields";
import { formatRelative } from "@/lib/utils/format";
import { listReviewQueue } from "@/features/leads/workflow";
import { PageHeader } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { SourceTag } from "@/components/intel/contact-value";
import { ContactReviewButtons } from "@/components/intel/lead-workflow";

export const metadata = { title: "Contact review queue" };

/**
 * Ambiguous matches: name-only website matches, candidate domains, public-page
 * values, different-domain emails, mismatched provider names. None counts as a
 * direct contact until a person approves it — a provider confidence score is never enough.
 */
export default async function ReviewPage() {
  const actor = await requireInternalPage("companies.read");
  const items = await listReviewQueue(actor, { limit: 200 });
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Research" title="Contact review queue" description="Uncertain matches wait here. Approving makes a value count as the company's direct contact; rejecting keeps it out. Check the evidence first — registration number, address, trading name, website." />
      {items.length ? (
        <ul className="divide-y divide-ink-100 rounded-xl border border-ink-200 bg-white">
          {items.map((k) => (
            <li key={String(k._id)} className="space-y-1 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0">
                  <span className="mr-2 text-xs uppercase tracking-wide text-ink-400">{k.type.replace("_", " ").toLowerCase()}</span>
                  <span className="break-all font-semibold text-ink-900">{k.value}</span>
                  {k.personName && <span className="text-ink-500"> · {k.personName}</span>}
                </p>
                <ContactReviewButtons contactId={String(k._id)} review={k.review ?? "PENDING"} />
              </div>
              <p className="flex flex-wrap items-center gap-2 text-xs text-ink-600">
                {k.companyId ? (
                  <Link href={`/dashboard/companies/${k.companyId.countryCode.toLowerCase()}/${k.companyId._id}`} className="font-medium text-brand-700 hover:underline">
                    {k.companyId.companyName}
                  </Link>
                ) : (
                  "Deleted company"
                )}
                {k.companyId?.registrationNumber && <span>{k.companyId.registrationNumber}</span>}
                {k.companyId?.website && <span>website on record: {k.companyId.website}</span>}
                <SourceTag kind={k.sourceKind as ContactSourceKind} source={k.source} />
                <span>{k.source}</span>
                {k.ownership && <Badge tone="warning">{CONTACT_OWNERSHIP_LABELS[k.ownership as ContactOwnership]}</Badge>}
                {k.providerConfidence !== undefined && k.providerConfidence !== null && <span>provider confidence {k.providerConfidence} (not decisive)</span>}
                <span className="text-ink-400">{formatRelative(k.createdAt)}</span>
              </p>
              {k.evidence?.map((e, i) => (
                <p key={i} className="text-xs text-ink-500">
                  • {e.detail}
                  {e.url && (
                    <>
                      {" "}
                      <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="text-brand-700 hover:underline">
                        page
                      </a>
                    </>
                  )}
                </p>
              ))}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={ShieldQuestion} title="Nothing to review" description="Ambiguous matches from research appear here." />
      )}
    </div>
  );
}
