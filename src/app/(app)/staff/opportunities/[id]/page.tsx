import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { requireTeamPage } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { getOpportunityDetail } from "@/features/opportunities/service";
import { CONTACT_ROUTE_LABELS, OPPORTUNITY_TYPE_LABELS, type ContactRoute } from "@/features/opportunities/constants";
import { formatInZone, zoneFor } from "@/features/opportunities/format";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/data";
import { ActivityBadge, CountryTag, SourceClassBadge, VerificationBadges } from "@/components/opportunities/badges";

export const metadata = { title: "Opportunity", robots: { index: false, follow: false } };

/** Read-only opportunity detail for granted team members (source facts only). */
export default async function StaffOpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireTeamPage("opportunities.view");
  const { id } = await params;
  const detail = await getOpportunityDetail(actor, id).catch((e) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  const o = detail.opportunity;
  const tz = zoneFor(o.countryCode);
  const safe = (u?: string | null) => (u && /^https?:\/\//i.test(u) ? u : undefined);
  return (
    <div className="space-y-5">
      <Link href={`/staff/opportunities?type=${o.type}`} className="inline-flex h-9 items-center gap-1 text-sm font-medium text-ink-600 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Opportunities
      </Link>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">{OPPORTUNITY_TYPE_LABELS[o.type as keyof typeof OPPORTUNITY_TYPE_LABELS] ?? o.type}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-900">{o.title || "(untitled)"}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-600">
          <span className="font-medium text-ink-800">{o.organization?.name ?? "Organization not published"}</span>
          <CountryTag code={o.countryCode} />
          {o.location && <span>{o.location}</span>}
          <ActivityBadge activity={o.activity} />
        </p>
        <VerificationBadges labels={o.labels ?? []} className="mt-3" />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Description" description={o.summary ? "As published by the source (may be truncated)." : undefined} />
          <CardContent>{o.summary ? <p className="whitespace-pre-line text-sm leading-relaxed text-ink-700">{o.summary}</p> : <p className="text-sm text-ink-500">No description available from the source.</p>}</CardContent>
        </Card>
        <Card>
          <CardHeader title="Source" />
          <CardContent className="space-y-3">
            <DescriptionList
              items={[
                { label: "Source type", value: <SourceClassBadge sourceClass={o.sourceClass} /> },
                { label: "Publisher", value: o.sourcePublisher ?? "—" },
                { label: "Published (source)", value: o.publishedAt ? formatInZone(o.publishedAt, tz, false) : "Not given by source" },
                { label: "First discovered", value: formatInZone(o.firstSeenAt, tz, false) },
                { label: "Last confirmed at source", value: o.lastSeenAt ? formatInZone(o.lastSeenAt, tz) : "Never" },
                { label: "Deadline", value: o.deadline ? formatInZone(o.deadline, tz) : o.deadlineText ? `“${o.deadlineText}” (as published)` : "Not published" },
                { label: "How to respond", value: CONTACT_ROUTE_LABELS[((o.contactRoutes ?? [])[0] ?? "NONE") as ContactRoute] },
              ]}
            />
            <div className="flex flex-wrap gap-3 text-sm">
              {safe(o.applyUrl) && (
                <a href={safe(o.applyUrl)} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
                  Apply / submit <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              )}
              {safe(o.sourceUrl) && (
                <a href={safe(o.sourceUrl)} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
                  Original source <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
      {(o.contacts ?? []).length > 0 && (
        <Card>
          <CardHeader title="Contacts" description="Only contacts the source published." />
          <CardContent>
            <ul className="divide-y divide-ink-100 text-sm">
              {o.contacts.map((c, i) => (
                <li key={i} className="py-2">
                  <p className="font-medium text-ink-900">{c.name ?? c.kind}</p>
                  <p className="text-ink-600">{[c.role, c.email, c.phone].filter(Boolean).join(" · ")}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
