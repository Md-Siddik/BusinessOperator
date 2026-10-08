import Link from "next/link";
import { Globe, Mail, Phone, Users } from "lucide-react";
import { countryName, getCountry } from "@/config/countries";
import { INDUSTRY_LABELS, type IndustryKey } from "@/config/industries";
import { LEAD_STAGE_LABELS, type LeadStage } from "@/lib/constants";
import type { CompanyDoc } from "@/models";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { ScorePill, Table, TBody, TD, TH, THead, TR } from "@/components/ui/data";
import { formatDate } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

const STAGE_TONE: Partial<Record<LeadStage, "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "violet">> = {
  NEW: "neutral",
  QUALIFIED: "info",
  RESEARCHING: "info",
  READY_FOR_OUTREACH: "brand",
  CONTACTED: "brand",
  REPLIED: "violet",
  MEETING: "violet",
  PROPOSAL: "warning",
  NEGOTIATION: "warning",
  WON: "success",
  CLIENT: "success",
  NOT_INTERESTED: "neutral",
  DO_NOT_CONTACT: "danger",
};

export function StageBadge({ stage }: { stage?: string | null }) {
  const s = (stage ?? "NEW") as LeadStage;
  return <Badge tone={STAGE_TONE[s] ?? "neutral"}>{LEAD_STAGE_LABELS[s] ?? s}</Badge>;
}

function Availability({ has, icon: Icon, label }: { has: boolean; icon: typeof Globe; label: string }) {
  return (
    <span title={`${label}: ${has ? "available" : "not available"}`} className={cn("inline-flex", has ? "text-emerald-600" : "text-ink-300")}>
      <Icon className="h-4 w-4" aria-hidden />
      <span className="sr-only">
        {label}: {has ? "yes" : "no"}
      </span>
    </span>
  );
}

export function companyHref(c: Pick<CompanyDoc, "_id" | "countryCode">) {
  return `/dashboard/companies/${c.countryCode.toLowerCase()}/${c._id}`;
}

export function CompanyTable({ companies, showCountry, threshold }: { companies: CompanyDoc[]; showCountry?: boolean; threshold?: number }) {
  return (
    <Table>
      <THead>
        <tr>
          <TH>Company</TH>
          {showCountry && <TH>Country</TH>}
          <TH>Registered</TH>
          <TH>Industry</TH>
          <TH>City</TH>
          <TH>Contact</TH>
          <TH className="text-right">Score</TH>
          <TH>Stage</TH>
        </tr>
      </THead>
      <TBody>
        {companies.map((c) => (
          <TR key={String(c._id)}>
            <TD className="max-w-72">
              <Link href={companyHref(c)} className="font-medium text-ink-900 hover:text-brand-700">
                {c.companyName}
              </Link>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-500">
                {c.legalForm && <span>{c.legalForm}</span>}
                {c.signals?.hiring && (
                  <span className="inline-flex items-center gap-0.5 text-violet-700">
                    <Users className="h-3 w-3" aria-hidden /> Hiring
                  </span>
                )}
                {c.isDemo && <DemoBadge label="Demo" className="px-1.5 py-0 text-[10px]" />}
              </div>
            </TD>
            {showCountry && (
              <TD>
                <span aria-hidden>{getCountry(c.countryCode)?.flag}</span> {countryName(c.countryCode)}
              </TD>
            )}
            <TD className="whitespace-nowrap tabular-nums">{formatDate(c.registrationDate)}</TD>
            <TD className="whitespace-nowrap">{INDUSTRY_LABELS[(c.industry ?? "other") as IndustryKey] ?? c.industry}</TD>
            <TD>{c.city ?? "—"}</TD>
            <TD>
              <span className="flex gap-2">
                <Availability has={!!c.website} icon={Globe} label="Website" />
                <Availability has={!!c.email} icon={Mail} label="Email" />
                <Availability has={!!c.phone} icon={Phone} label="Phone" />
              </span>
            </TD>
            <TD className="text-right">
              <ScorePill score={c.lead?.score ?? 0} threshold={threshold} />
            </TD>
            <TD>
              <StageBadge stage={c.lead?.stage} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
