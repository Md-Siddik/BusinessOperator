import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { countryName } from "@/config/countries";
import { getLanguage } from "@/config/languages";
import { requireInternalPage } from "@/lib/auth/session";
import { formatDate } from "@/lib/utils/format";
import { listTemplates } from "@/features/outreach/service";
import { resolveCountry } from "@/features/site/country-context";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";
import { OutreachTabs } from "@/components/app/section-tabs";

export const metadata = { title: "Templates" };

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  const actor = await requireInternalPage("outreach.manage");
  const sp = await searchParams;
  const ctx = await resolveCountry(sp.country);
  const templates = await listTemplates(actor, { country: ctx.code });
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Outreach"
        title="Email templates"
        description="Localised templates per country and language (independent of each other). International templates apply to every country."
        actions={
          <ButtonLink href="/dashboard/outreach/templates/new" size="sm">
            <Plus className="h-4 w-4" aria-hidden /> New template
          </ButtonLink>
        }
      />
      <OutreachTabs active="templates" country={ctx.code} />
      <Card>
        {templates.length === 0 ? (
          <EmptyState icon={FileText} title="No templates yet" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Country</TH>
                <TH>Language</TH>
                <TH>Subject</TH>
                <TH>Status</TH>
                <TH>Updated</TH>
              </tr>
            </THead>
            <TBody>
              {templates.map((t) => (
                <TR key={String(t._id)}>
                  <TD>
                    <Link href={`/dashboard/outreach/templates/${t._id}`} className="font-medium text-ink-900 hover:text-brand-700">
                      {t.name}
                    </Link>
                  </TD>
                  <TD>{t.countryCode === "INTL" ? "International" : countryName(t.countryCode)}</TD>
                  <TD>{getLanguage(t.languageCode).englishName}</TD>
                  <TD className="max-w-80 truncate text-ink-500">{t.subject}</TD>
                  <TD>{t.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</TD>
                  <TD className="text-xs text-ink-500">{formatDate(t.updatedAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
