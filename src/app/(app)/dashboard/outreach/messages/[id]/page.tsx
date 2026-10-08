import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, ShieldCheck, ShieldX } from "lucide-react";
import { countryName } from "@/config/countries";
import { getLanguage } from "@/config/languages";
import { requireInternalPage } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utils/format";
import { getOutreachMessage } from "@/features/outreach/service";
import { getSetting } from "@/features/settings/service";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge, DemoBadge, StatusBadge } from "@/components/ui/badge";
import { DescriptionList, PageHeader } from "@/components/ui/data";
import { Alert } from "@/components/ui/feedback";
import { MessageReview } from "@/components/app/outreach-forms";

export const metadata = { title: "Review email" };

export default async function OutreachMessagePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireInternalPage("outreach.manage");
  const { id } = await params;
  let data;
  try {
    data = await getOutreachMessage(actor, id);
  } catch {
    notFound();
  }
  const { message: m, compliance } = data;
  const outreach = await getSetting("outreach");
  const company = m.companyId as unknown as { _id: string; companyName: string; countryCode: string; website?: string; source?: string; isDemo?: boolean } | null;
  const personalization = (m.personalization ?? {}) as { variables?: Record<string, string | undefined>; missing?: string[] };
  const editable = ["DRAFT", "REJECTED"].includes(m.status);
  return (
    <div className="space-y-6">
      <Link href={`/dashboard/outreach/queue?country=${m.countryCode ?? "ALL"}`} className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Email queue
      </Link>
      <PageHeader
        eyebrow={<span className="flex items-center gap-2">Outreach review {m.isDemo && <DemoBadge />}</span>}
        title={m.subject}
        actions={
          <span className="flex gap-1.5">
            <StatusBadge status={m.status} />
            {m.replyStatus === "REPLIED" && <Badge tone="violet">Replied</Badge>}
            {m.simulated && <Badge tone="warning">Simulated send (console provider)</Badge>}
          </span>
        }
      />
      {m.status === "REJECTED" && m.rejectedReason && <Alert tone="warning" title="Returned for changes">{m.rejectedReason}</Alert>}
      {m.error && <Alert tone="danger" title="Delivery error">{m.error}</Alert>}

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader title={editable ? "Edit draft" : "Message"} />
          <CardContent>
            {editable ? (
              <MessageReview id={String(m._id)} status={m.status} replyStatus={m.replyStatus ?? "NONE"} editable subject={m.subject} body={m.body} canApprove={can(actor, "outreach.approve")} />
            ) : (
              <>
                <pre className="whitespace-pre-wrap rounded-xl bg-ink-50 p-5 font-sans text-sm leading-relaxed text-ink-800">{m.body}</pre>
                <p className="mt-3 rounded-lg border border-dashed border-ink-200 px-4 py-3 text-xs text-ink-500">Appended at send: compliance footer with one-click unsubscribe link{outreach.postalAddress ? " and postal address" : ""}.</p>
                <div className="mt-5">
                  <MessageReview id={String(m._id)} status={m.status} replyStatus={m.replyStatus ?? "NONE"} editable={false} subject={m.subject} body={m.body} canApprove={can(actor, "outreach.approve")} />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Compliance" />
            <CardContent className="space-y-3 text-sm">
              {compliance.suppressed ? (
                <p className="flex items-center gap-2 font-medium text-red-700">
                  <ShieldX className="h-4 w-4" aria-hidden /> Recipient is suppressed ({compliance.reason?.toLowerCase().replace(/_/g, " ")}) — cannot be sent
                </p>
              ) : (
                <p className="flex items-center gap-2 font-medium text-emerald-700">
                  <ShieldCheck className="h-4 w-4" aria-hidden /> Not on the suppression list
                </p>
              )}
              <DescriptionList
                items={[
                  { label: "Contact source", value: m.contactSource ?? "—" },
                  { label: "Human approval", value: m.approvedBy ? `${(m.approvedBy as unknown as { name: string }).name} · ${formatDateTime(m.approvedAt)}` : "Required" },
                  { label: "Last compliance check", value: formatDateTime(m.compliance?.checkedAt) },
                  { label: "Unsubscribe", value: "One-click link + List-Unsubscribe header" },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Details" />
            <CardContent>
              <DescriptionList
                items={[
                  { label: "Recipient", value: `${m.toName ? `${m.toName} · ` : ""}${m.to}` },
                  { label: "Company", value: company ? <Link className="text-brand-700" href={`/dashboard/companies/${company.countryCode.toLowerCase()}/${company._id}`}>{company.companyName}</Link> : "—" },
                  { label: "Country · Language", value: `${countryName(m.countryCode)} · ${getLanguage(m.languageCode ?? "en").englishName}` },
                  { label: "Sender", value: `${outreach.senderName} <${m.from ?? outreach.senderEmail}>` },
                  { label: "Campaign", value: (m.campaignId as unknown as { name?: string })?.name ?? "Individual" },
                  { label: "Author", value: (m.createdBy as unknown as { name?: string })?.name },
                  { label: "Sent", value: formatDateTime(m.sentAt) },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Personalization" description="Values come only from stored facts." />
            <CardContent className="space-y-3 text-sm">
              <ul className="space-y-1">
                {Object.entries(personalization.variables ?? {}).map(([k, v]) => (
                  <li key={k} className="flex justify-between gap-3">
                    <code className="text-xs text-ink-500">{`{{${k}}}`}</code>
                    <span className="truncate text-right">{v || <span className="text-ink-400">— missing</span>}</span>
                  </li>
                ))}
              </ul>
              {personalization.missing && personalization.missing.length > 0 && (
                <p className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> Missing facts were left out (not invented): {personalization.missing.join(", ")}. Review the wording.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
