import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { countryName } from "@/config/countries";
import { getLanguage } from "@/config/languages";
import { INDUSTRY_LABELS, type IndustryKey } from "@/config/industries";
import { LEAD_STAGE_LABELS, type LeadStage } from "@/lib/constants";
import { requireInternalPage } from "@/lib/auth/session";
import { formatDate } from "@/lib/utils/format";
import { getCampaignDetail } from "@/features/outreach/service";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { DescriptionList, PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui/data";
import { Funnel } from "@/components/charts/chart-card";
import { CampaignControls } from "@/components/app/outreach-forms";

export const metadata = { title: "Campaign" };

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireInternalPage("outreach.manage");
  const { id } = await params;
  let detail;
  try {
    detail = await getCampaignDetail(actor, id);
  } catch {
    notFound();
  }
  const { campaign: c, messages, stats } = detail;
  return (
    <div className="space-y-6">
      <Link href={`/dashboard/outreach?country=${c.countryCode}`} className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Campaigns
      </Link>
      <PageHeader eyebrow={`${countryName(c.countryCode)} · ${getLanguage(c.languageCode).englishName}`} title={c.name} actions={<CampaignControls id={String(c._id)} status={c.status} />} />
      <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader title="Campaign" action={<StatusBadge status={c.status} />} />
          <CardContent>
            <DescriptionList
              items={[
                { label: "Template", value: c.templateId?.name },
                { label: "Industry", value: c.industry ? INDUSTRY_LABELS[c.industry as IndustryKey] : "All industries" },
                { label: "Minimum score", value: c.segment?.minScore ?? 0 },
                { label: "Stages", value: (c.segment?.stages ?? []).map((s) => LEAD_STAGE_LABELS[s as LeadStage]).join(", ") },
                { label: "Registered within", value: c.segment?.registeredWithinDays ? `${c.segment.registeredWithinDays} days` : "Any time" },
                { label: "Website", value: c.segment?.noWebsiteOnly ? "Only without website" : "Any" },
                { label: "Created by", value: (c.createdBy as unknown as { name?: string })?.name },
                { label: "Created", value: formatDate(c.createdAt) },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="Campaign analytics" description="Meetings, proposals and clients count targeted companies that reached each stage." />
          <CardContent>
            <Funnel
              steps={[
                { stage: "Target", count: stats.target + stats.drafted },
                { stage: "Drafted", count: stats.drafted },
                { stage: "Approved", count: stats.approved },
                { stage: "Sent", count: stats.sent },
                { stage: "Delivered", count: stats.delivered },
                { stage: "Replies", count: stats.replies },
                { stage: "Meetings", count: stats.meetings },
                { stage: "Proposals", count: stats.proposals },
                { stage: "Clients", count: stats.clients },
              ]}
            />
            <p className="mt-3 text-xs text-ink-500">“Target” = companies currently matching the segment plus those already drafted. “Delivered” requires provider webhooks.</p>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader title="Messages" description={`${messages.length} messages`} />
        <Table>
          <THead>
            <tr>
              <TH>Company</TH>
              <TH>Recipient</TH>
              <TH>Subject</TH>
              <TH>Status</TH>
              <TH>Date</TH>
            </tr>
          </THead>
          <TBody>
            {messages.map((m) => {
              const company = m.companyId as unknown as { companyName?: string } | null;
              return (
                <TR key={String(m._id)}>
                  <TD className="font-medium">{company?.companyName ?? "—"}</TD>
                  <TD className="text-ink-500">{m.to}</TD>
                  <TD className="max-w-80 truncate">
                    <Link href={`/dashboard/outreach/messages/${m._id}`} className="hover:text-brand-700">
                      {m.subject}
                    </Link>
                  </TD>
                  <TD>
                    <span className="flex gap-1.5">
                      <StatusBadge status={m.status} />
                      {m.replyStatus === "REPLIED" && <Badge tone="violet">Replied</Badge>}
                    </span>
                  </TD>
                  <TD className="whitespace-nowrap text-xs text-ink-500">{formatDate(m.sentAt ?? m.createdAt)}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
