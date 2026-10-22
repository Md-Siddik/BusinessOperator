import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MessageSquareText, UserCircle } from "lucide-react";
import { requireOwnerPage } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { ownerMetadata } from "@/features/opportunities/metadata";
import { getVisitor } from "@/features/website-analytics/service";
import { Card, CardHeader } from "@/components/ui/card";
import { DescriptionList, PageHeader } from "@/components/ui/data";
import { Badge } from "@/components/ui/badge";
import { ANALYTICS_PATH, fmtDateTime, fmtDuration, fmtTime, VisitorStatusBadge } from "@/components/website-analytics/parts";

export const dynamic = "force-dynamic";
export const generateMetadata = ownerMetadata("Website visitor");

/** One visitor's visits, page by page — OWNER ONLY. */
export default async function WebsiteVisitorPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireOwnerPage();
  const { id } = await params;
  const v = await getVisitor(actor, id).catch((err) => {
    if (err instanceof AppError && err.status === 404) notFound();
    throw err;
  });
  const utm = v.firstUtm && Object.entries(v.firstUtm).filter(([, val]) => val).map(([k, val]) => `${k}=${val}`).join(" · ");

  return (
    <div className="space-y-6">
      <Link href={`${ANALYTICS_PATH}?tab=visitors`} className="inline-flex items-center gap-1 text-sm font-medium text-ink-600 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Visitors
      </Link>
      <PageHeader eyebrow="Website Analytics" title={v.user ? v.user.name : `Anonymous Visitor #${v.label}`} description={v.user ? `Logged-in account · browser #${v.label}` : "An anonymous browser that accepted analytics. Not linked to a person unless they identify themselves."} actions={<VisitorStatusBadge status={v.status} />} />

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader title="Summary" />
          <div className="px-5 pb-5">
            <DescriptionList
              items={[
                { label: "First visit", value: fmtDateTime(v.firstSeen) },
                { label: "Last visit", value: fmtDateTime(v.lastSeen) },
                { label: "Total sessions", value: v.totalSessions },
                { label: "Total page views", value: v.totalPageViews },
                { label: "Traffic source", value: [v.source, v.firstReferrerDomain].filter(Boolean).join(" · ") },
                ...(utm ? [{ label: "First campaign", value: utm }] : []),
                ...(v.firstLandingPage ? [{ label: "First landing page", value: v.firstLandingPage }] : []),
              ]}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Identified by the visitor" description="Only from their own login or enquiry." />
          <div className="space-y-3 px-5 pb-5 text-sm">
            {!v.user && v.enquiries.length === 0 && <p className="text-ink-500">Not identified. This visitor has not logged in or sent an enquiry.</p>}
            {v.user && (
              <p className="flex items-start gap-2 text-ink-700">
                <UserCircle className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                <span>
                  Logged in as <span className="font-medium text-ink-900">{v.user.name}</span> ({v.user.email}) · {v.user.role.toLowerCase()} account
                </span>
              </p>
            )}
            {v.enquiries.map((e) => (
              <div key={e.id} className="flex items-start gap-2 text-ink-700">
                <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                <span>
                  Enquiry on {fmtDateTime(e.createdAt)} from <span className="font-medium text-ink-900">{e.company ? `${e.company} (${e.name})` : e.name}</span> · {e.email}
                  {e.serviceSlug && <> · from /services/{e.serviceSlug}</>}{" "}
                  <Link href="/dashboard/clients?tab=inquiries" className="font-medium text-brand-700 hover:underline">
                    Open enquiries
                  </Link>
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Timeline" description="Newest visit first. Times in Norwegian time." />
        <ol className="divide-y divide-ink-100">
          {v.sessions.map((s) => (
            <li key={s.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-ink-900">Visit {s.sessionNo}</span>
                <span className="text-ink-500">
                  {fmtDateTime(s.startedAt)} · {fmtDuration(s.durationSeconds)} · {s.pages.length} page{s.pages.length === 1 ? "" : "s"}
                </span>
                <Badge>{s.channel}</Badge>
                {s.campaign && <Badge tone="violet">{s.campaign}</Badge>}
                {s.enquiries > 0 && <Badge tone="success">Sent an enquiry</Badge>}
              </div>
              <ol className="mt-3 space-y-1.5 border-l border-ink-200 pl-4">
                {s.pages.map((p, i) => (
                  <li key={`${p.path}-${i}`} className="relative text-sm">
                    <span className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-brand-400" aria-hidden />
                    <span className="tabular-nums text-ink-500">{fmtTime(p.at)}</span> <span className="text-ink-300">—</span> <span className="text-ink-800">{p.path}</span>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
