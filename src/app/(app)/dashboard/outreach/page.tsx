import Link from "next/link";
import { Send } from "lucide-react";
import { countryName, getCountry } from "@/config/countries";
import { getLanguage } from "@/config/languages";
import { requireInternalPage } from "@/lib/auth/session";
import { formatDate } from "@/lib/utils/format";
import { EmailMessage } from "@/models";
import { listCampaigns, listTemplates } from "@/features/outreach/service";
import { resolveCountry } from "@/features/site/country-context";
import { Card } from "@/components/ui/card";
import { DemoBadge, StatusBadge } from "@/components/ui/badge";
import { PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";
import { OutreachTabs } from "@/components/app/section-tabs";
import { NewCampaignButton } from "@/components/app/outreach-forms";

export const metadata = { title: "Campaigns" };

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  const actor = await requireInternalPage("outreach.manage");
  const sp = await searchParams;
  const ctx = await resolveCountry(sp.country);
  const [campaigns, templates, pending] = await Promise.all([
    listCampaigns(actor, { country: ctx.code }),
    listTemplates(actor),
    EmailMessage.countDocuments({ kind: "OUTREACH", status: "PENDING_APPROVAL", ...(ctx.code !== "ALL" && { countryCode: ctx.code }) }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Outreach"
        title={`Campaigns · ${ctx.country?.name ?? "All Countries"}`}
        description="Research → Draft → Review → Approve → Send. Campaigns only generate drafts; every email is reviewed and approved by a person."
        actions={<NewCampaignButton defaultCountry={ctx.code} templates={templates.filter((t) => t.active).map((t) => ({ id: String(t._id), label: `${t.name} (${t.languageCode})`, countryCode: t.countryCode, languageCode: t.languageCode }))} />}
      />
      <OutreachTabs active="campaigns" country={ctx.code} pending={pending} />
      <Card>
        {campaigns.length === 0 ? (
          <EmptyState icon={Send} title="No campaigns yet" description="Create a country-specific campaign to generate personalised drafts for a target segment." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Campaign</TH>
                <TH>Country · Language</TH>
                <TH>Status</TH>
                <TH className="text-right">Drafted</TH>
                <TH className="text-right">Awaiting review</TH>
                <TH className="text-right">Sent</TH>
                <TH className="text-right">Replies</TH>
                <TH>Created</TH>
              </tr>
            </THead>
            <TBody>
              {campaigns.map((c) => (
                <TR key={String(c._id)}>
                  <TD>
                    <Link href={`/dashboard/outreach/campaigns/${c._id}`} className="font-medium text-ink-900 hover:text-brand-700">
                      {c.name}
                    </Link>
                    <p className="text-xs text-ink-500">
                      {(c.templateId as unknown as { name?: string })?.name} {c.isDemo && <DemoBadge label="Demo" className="ml-1 px-1.5 py-0 text-[10px]" />}
                    </p>
                  </TD>
                  <TD className="whitespace-nowrap">
                    <span aria-hidden>{getCountry(c.countryCode)?.flag}</span> {countryName(c.countryCode)} · {getLanguage(c.languageCode).englishName}
                  </TD>
                  <TD>
                    <StatusBadge status={c.status} />
                  </TD>
                  <TD className="text-right tabular-nums">{c.stats.drafted}</TD>
                  <TD className="text-right tabular-nums">{c.stats.pending}</TD>
                  <TD className="text-right tabular-nums">{c.stats.sent}</TD>
                  <TD className="text-right tabular-nums">{c.stats.replies}</TD>
                  <TD className="whitespace-nowrap text-xs text-ink-500">
                    {formatDate(c.createdAt)} · {(c.createdBy as unknown as { name?: string })?.name}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
