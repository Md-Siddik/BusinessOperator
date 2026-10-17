"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, ExternalLink, ShieldAlert, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { formatDay } from "@/lib/dates/country-time";
import { formatRelative } from "@/lib/utils/format";
import { Spinner } from "@/components/ui/spinner";
import { ContactValue, CopyButton } from "./contact-value";
import { CompanyEmailActions, type CompanyEmailContext } from "@/components/email-sender/company-email-actions";
import { CompletenessStars, ContactChecklist, FreshnessBadge } from "./quality";
import { QualifyButtons } from "./qualify-buttons";
import type { CompanyRow, SourceCapabilities } from "./types";

type Detail = {
  company: {
    incorporationDate?: string;
    companyPurpose?: string;
    businessActivity?: string;
    industryCodeSystem?: string;
    postalAddress?: string;
    people?: { name: string; role?: string; group?: string }[];
    peopleFetchedAt?: string;
    sourceUpdatedAt?: string;
    employees?: number;
  };
  contacts: { _id: string; type: string; value: string; sourceKind: string; source: string; verified?: boolean }[];
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-ink-100 px-5 py-4">
      <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-500">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-2 py-1 text-sm">
      <dt className="text-ink-500">{label}</dt>
      <dd className="min-w-0 text-ink-900">{children}</dd>
    </div>
  );
}

/** Right-side research panel with Previous / Next through the current list (← / → keys). */
export function CompanyDrawer({
  rows,
  index,
  capabilities,
  canQualify,
  onIndexChange,
  onPatch,
  emailContext,
}: {
  rows: CompanyRow[];
  index: number | null;
  capabilities: Record<string, SourceCapabilities>;
  canQualify: boolean;
  onIndexChange: (i: number | null) => void;
  onPatch: (id: string, p: Partial<CompanyRow>) => void;
  emailContext?: CompanyEmailContext;
}) {
  const row = index !== null ? rows[index] : undefined;
  const [detail, setDetail] = useState<{ id: string; data: Detail } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const open = !!row;

  useEffect(() => {
    if (!row) return;
    let cancelled = false;
    apiFetch<Detail>(`/api/companies/${row.id}`)
      .then((d) => !cancelled && setDetail({ id: row.id, data: d }))
      .catch(() => !cancelled && setError("Could not load all details."));
    return () => {
      cancelled = true;
    };
  }, [row]);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Keys inside a form field or an open dialog (e.g. the email composer) belong to it.
      if (target.closest("input, textarea, select, dialog")) return;
      if (e.key === "Escape") onIndexChange(null);
      if (e.key === "ArrowRight" && index !== null && index < rows.length - 1) onIndexChange(index + 1);
      if (e.key === "ArrowLeft" && index !== null && index > 0) onIndexChange(index - 1);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, index, rows.length, onIndexChange]);

  if (!row || index === null) return null;
  const d = detail?.id === row.id ? detail.data : null;
  const caps = capabilities[row.countryCode];
  const missing = (field: keyof SourceCapabilities) => (row.enrichedAt ? "Not found in registry or on website" : caps && !caps[field] ? "Not published by this registry" : "Not available from registry");
  const verifiedEmail = d?.contacts.find((c) => c.type === "EMAIL" && c.value === row.email)?.verified;
  const otherContacts = d?.contacts.filter((c) => ![row.email, row.phone, row.mobile, row.website, row.contactPerson?.name].includes(c.value)) ?? [];

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`${row.name} — company details`}>
      <div className="absolute inset-0 animate-fade-in bg-ink-950/40" onClick={() => onIndexChange(null)} aria-hidden />
      <div ref={panelRef} tabIndex={-1} className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col bg-white shadow-lifted outline-none">
        {/* Header with Previous / Next */}
        <div className="flex items-center justify-between gap-2 border-b border-ink-200 px-4 py-2.5">
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => onIndexChange(index - 1)} disabled={index === 0} className="inline-flex h-8 items-center gap-1 rounded-lg border border-ink-200 px-2 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-40" aria-label="Previous company">
              <ChevronLeft className="h-4 w-4" aria-hidden /> Previous
            </button>
            <button type="button" onClick={() => onIndexChange(index + 1)} disabled={index >= rows.length - 1} className="inline-flex h-8 items-center gap-1 rounded-lg border border-ink-200 px-2 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-40" aria-label="Next company">
              Next <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
            <span className="ml-2 text-xs tabular-nums text-ink-500">
              {index + 1} of {rows.length} on this page
            </span>
          </div>
          <button type="button" onClick={() => onIndexChange(null)} className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100" aria-label="Close">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto">
          {/* Company */}
          <div className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-ink-900">{row.name}</h2>
              {row.status && <span className={row.status === "Active" ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold uppercase text-emerald-800" : "rounded-full bg-ink-100 px-2 py-0.5 text-xs font-semibold uppercase text-ink-700"}>{row.status}</span>}
              {row.isDemo && <span className="rounded bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-900">DEMO DATA</span>}
            </div>
            <dl className="mt-2">
              {row.registrationNumber && (
                <Row label="Registration no.">
                  <span className="inline-flex items-center gap-1.5 tabular-nums">
                    {row.registrationNumber} <CopyButton value={row.registrationNumber} label="registration number" />
                  </span>
                </Row>
              )}
              <Row label="Registered">
                <span className="font-semibold">{row.registrationDay ? formatDay(row.registrationDay) : "Not available"}</span>
              </Row>
              {d?.company.incorporationDate && <Row label="Founded">{formatDay(d.company.incorporationDate.slice(0, 10))}</Row>}
              {row.legalForm && <Row label="Legal form">{row.legalForm}</Row>}
              <Row label="Industry">
                {row.industryLabel}
                {row.industryCode && (
                  <span className="ml-1 text-xs text-ink-500">
                    ({row.industryCode}
                    {d?.company.industryCodeSystem ? ` · ${d.company.industryCodeSystem}` : ""})
                  </span>
                )}
              </Row>
            </dl>
            {row.marketingProtected && (
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> The registry marks this company as protected from marketing. It is excluded from outreach.
              </p>
            )}
          </div>

          <Section title="Contact">
            <div className="grid gap-3 sm:grid-cols-2">
              <ContactValue kind="email" showLabel value={row.email} sourceKind={row.sources.email?.kind} source={row.sources.email?.source} secondary={verifiedEmail ? "Email domain accepts mail (MX)" : undefined} missing={missing("email")} disabledActions={row.isDemo} emailActions={emailContext && row.email ? <CompanyEmailActions row={row} ctx={emailContext} onSent={(p) => onPatch(row.id, p)} /> : undefined} />
              <ContactValue kind="phone" showLabel value={row.phone} sourceKind={row.sources.phone?.kind} source={row.sources.phone?.source} missing={missing("phone")} disabledActions={row.isDemo} />
              <ContactValue kind="mobile" showLabel value={row.mobile} sourceKind={row.sources.mobile?.kind} source={row.sources.mobile?.source} missing={missing("mobile")} disabledActions={row.isDemo} />
              <ContactValue kind="website" showLabel value={row.website} sourceKind={row.sources.website?.kind} source={row.sources.website?.source} missing={missing("website")} disabledActions={row.isDemo} />
              <ContactValue kind="person" showLabel value={row.contactPerson?.name} secondary={row.contactPerson?.role} sourceKind={row.sources.contactPerson?.kind} missing={caps?.person ? "Not registered" : "Not published by this registry"} />
            </div>
            {otherContacts.length > 0 && (
              <div className="mt-3 rounded-lg bg-ink-50 p-3">
                <p className="mb-1 text-xs font-medium text-ink-600">Other values on record</p>
                <ul className="space-y-1 text-xs text-ink-700">
                  {otherContacts.map((c) => (
                    <li key={c._id}>
                      <span className="font-medium">{c.value}</span> · {c.type.toLowerCase().replace("_", " ")} · {c.source}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>

          <Section title="Address">
            <ContactValue kind="address" value={[row.address, [row.postalCode, row.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || undefined} missing="Address not available" disabledActions />
            {row.region && <p className="ml-5 mt-1 text-xs text-ink-500">Municipality / region: {row.region}</p>}
            {d?.company.postalAddress && <p className="ml-5 mt-1 text-xs text-ink-500">Postal address: {d.company.postalAddress}</p>}
          </Section>

          <Section title="Business">
            {d === null && !error ? (
              <Spinner className="h-4 w-4" label="Loading" />
            ) : (
              <div className="space-y-2 text-sm text-ink-800">
                {d?.company.businessActivity && (
                  <p>
                    <span className="text-ink-500">Activity: </span>
                    {d.company.businessActivity}
                  </p>
                )}
                {d?.company.companyPurpose && (
                  <p>
                    <span className="text-ink-500">Purpose: </span>
                    {d.company.companyPurpose}
                  </p>
                )}
                {!d?.company.businessActivity && !d?.company.companyPurpose && <p className="text-xs italic text-ink-400">No business description published by the source.</p>}
              </div>
            )}
          </Section>

          <Section title="People & roles">
            {d?.company.people?.length ? (
              <ul className="space-y-1.5 text-sm">
                {d.company.people.slice(0, 12).map((p, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="font-medium text-ink-900">{p.name}</span>
                    <span className="text-right text-xs text-ink-500">{p.role}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs italic text-ink-400">{caps?.person ? (d?.company.peopleFetchedAt ? "No roles registered." : "Roles load when you open the full profile.") : "This registry does not publish roles."}</p>
            )}
          </Section>

          <Section title="Data quality">
            <CompletenessStars value={row.completeness} />
            <ContactChecklist className="mt-2" flags={row.flags} />
          </Section>

          <Section title="Source">
            <dl>
              <Row label="Source">{row.sourceName ?? "—"}</Row>
              <Row label="Freshness">
                <FreshnessBadge freshness={row.freshness} />
              </Row>
              <Row label="Last fetched">{row.fetchedAt ? `${formatRelative(row.fetchedAt)} (${new Date(row.fetchedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })})` : "—"}</Row>
            </dl>
            {row.sourceUrl && !row.isDemo && (
              <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
                View official registry record <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            )}
          </Section>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-200 px-4 py-3">
          <QualifyButtons key={row.id} companyId={row.id} relevance={row.relevance} saved={row.saved} stage={row.stage} canQualify={canQualify} size="md" onChange={(p) => onPatch(row.id, p)} />
          <Link href={row.href} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink-900 px-3 text-sm font-medium text-white hover:bg-ink-800">
            Full profile <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  );
}
