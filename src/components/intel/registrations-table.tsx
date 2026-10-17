"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Columns3, Eye, ShieldAlert } from "lucide-react";
import { formatDay } from "@/lib/dates/country-time";
import { cn } from "@/lib/utils";
import { Dropdown } from "@/components/ui/overlay";
import { ContactValue, CopyButton } from "./contact-value";
import { CompletenessStars } from "./quality";
import { QualifyButtons } from "./qualify-buttons";
import { CompanyDrawer } from "./company-drawer";
import { ContactStatus } from "./contact-status";
import { CompanyEmailActions, type CompanyEmailContext } from "@/components/email-sender/company-email-actions";

const FRESHNESS_SHORT: Record<string, string> = { REAL_TIME: "Real-time", NEAR_REAL_TIME: "Near real-time", DAILY: "Daily", PERIODIC: "Periodic", UNKNOWN: "Freshness unknown" };
import type { CompanyRow, SourceCapabilities } from "./types";

const OPTIONAL_COLUMNS = [
  { id: "status", label: "Contact status" },
  { id: "service", label: "Suggested service" },
  { id: "registered", label: "Registration date" },
  { id: "industry", label: "Industry" },
  { id: "location", label: "Location" },
  { id: "person", label: "Contact person" },
  { id: "quality", label: "Data completeness" },
  { id: "lead", label: "Lead / qualification" },
] as const;
type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number]["id"];
const STORAGE_KEY = "et_registration_columns";

function missingLabel(field: keyof SourceCapabilities, caps: Record<string, SourceCapabilities>, row: CompanyRow) {
  const c = caps[row.countryCode];
  if (row.enrichedAt) return "Not found in registry or on website";
  if (c && !c[field]) return "Not published by this registry";
  return "Not available from registry";
}

export function RegistrationsTable({ rows, capabilities, canQualify, showCountry, emailContext }: { rows: CompanyRow[]; capabilities: Record<string, SourceCapabilities>; canQualify: boolean; showCountry?: boolean; emailContext?: CompanyEmailContext }) {
  const [hidden, setHidden] = useState<Set<OptionalColumn>>(new Set());
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Partial<CompanyRow>>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore a per-viewer column preference after hydration
      if (raw) setHidden(new Set(JSON.parse(raw) as OptionalColumn[]));
    } catch {
      /* storage unavailable */
    }
  }, []);

  const toggle = (id: OptionalColumn) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  const show = (id: OptionalColumn) => !hidden.has(id);
  const data = rows.map((r) => ({ ...r, ...overrides[r.id] }));
  const patch = useCallback((id: string, p: Partial<CompanyRow>) => setOverrides((o) => ({ ...o, [id]: { ...o[id], ...p } })), []);
  const emailActions = (r: CompanyRow) => (emailContext && r.email ? <CompanyEmailActions row={r} ctx={emailContext} onSent={(p) => patch(r.id, p)} /> : undefined);

  return (
    <>
      <div className="mb-2 hidden items-center justify-end md:flex">
        <Dropdown
          label="Columns"
          trigger={({ open, toggle: t, id }) => (
            <button type="button" onClick={t} aria-haspopup="menu" aria-expanded={open} aria-controls={id} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2.5 text-xs font-medium text-ink-700 hover:bg-ink-50">
              <Columns3 className="h-3.5 w-3.5" aria-hidden /> Columns
            </button>
          )}
        >
          {() => (
            <div className="p-1">
              <p className="px-2 pb-1 text-[11px] text-ink-500">Company, email, phone and website are always shown.</p>
              {OPTIONAL_COLUMNS.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-700 hover:bg-ink-50">
                  <input type="checkbox" checked={show(c.id)} onChange={() => toggle(c.id)} className="h-4 w-4 rounded border-ink-300 text-brand-600" />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </Dropdown>
      </div>

      {/* Desktop / tablet: dense table with sticky header and sticky company column */}
      <div className="scroll-thin hidden max-h-[78vh] overflow-auto rounded-xl border border-ink-200 bg-white md:block">
        <table className="w-full min-w-[1320px] border-separate border-spacing-0 text-left text-sm">
          <thead className="sticky top-0 z-20">
            <tr className="bg-ink-50 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              <th scope="col" className="sticky left-0 z-30 w-[240px] border-b border-ink-200 bg-ink-50 px-3 py-2.5">
                Company
              </th>
              {show("registered") && <th scope="col" className="border-b border-ink-200 px-3 py-2.5">Registered</th>}
              {show("industry") && <th scope="col" className="border-b border-ink-200 px-3 py-2.5">Industry</th>}
              {show("location") && <th scope="col" className="border-b border-ink-200 px-3 py-2.5">Location</th>}
              <th scope="col" className="min-w-[200px] border-b border-ink-200 px-3 py-2.5">Email</th>
              <th scope="col" className="min-w-[160px] border-b border-ink-200 px-3 py-2.5">Phone</th>
              <th scope="col" className="min-w-[170px] border-b border-ink-200 px-3 py-2.5">Website</th>
              {show("person") && <th scope="col" className="border-b border-ink-200 px-3 py-2.5">Contact person</th>}
              {show("status") && <th scope="col" className="min-w-[170px] border-b border-ink-200 px-3 py-2.5">Contact status</th>}
              {show("service") && <th scope="col" className="border-b border-ink-200 px-3 py-2.5">Suggested service</th>}
              {show("quality") && <th scope="col" className="border-b border-ink-200 px-3 py-2.5">Data</th>}
              {show("lead") && <th scope="col" className="border-b border-ink-200 px-3 py-2.5">Lead</th>}
              <th scope="col" className="border-b border-ink-200 px-3 py-2.5">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((r, i) => (
              <Fragment key={r.id}>
                {(i === 0 || data[i - 1]!.direct.has !== r.direct.has) && (
                  <tr>
                    <td colSpan={20} className={cn("border-b px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide", r.direct.has ? "border-emerald-100 bg-emerald-50/70 text-emerald-800" : "border-ink-100 bg-ink-50 text-ink-500")}>
                      {r.direct.has ? "Direct contact available — email or phone" : "No direct contact yet — still visible, research continues"}
                    </td>
                  </tr>
                )}
              <tr className={cn("group align-top", r.relevance === "NOT_RELEVANT" && "opacity-60")}>
                <td className="sticky left-0 z-10 border-b border-ink-100 bg-white px-3 py-3 group-hover:bg-ink-50/80">
                  <button type="button" onClick={() => setOpenIndex(i)} className="block text-left font-semibold text-ink-900 hover:text-brand-700 hover:underline">
                    {r.name}
                  </button>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                    {showCountry && <span className="font-medium text-ink-700">{r.countryCode}</span>}
                    {r.registrationNumber && (
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        {r.registrationNumber} <CopyButton value={r.registrationNumber} label="registration number" className="h-5 px-1 text-[10px]" />
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-1 text-[11px] text-ink-500">
                    {r.legalForm && <span>{r.legalForm}</span>}
                    {r.isDemo && <span className="rounded bg-amber-100 px-1 font-semibold text-amber-900">DEMO</span>}
                    {r.freshness && <span title={`${r.sourceName ?? "Source"} · fetched ${r.fetchedAt ? new Date(r.fetchedAt).toLocaleString("en-GB") : "—"}`}>{FRESHNESS_SHORT[r.freshness] ?? r.freshness}</span>}
                    {r.eventType && r.eventType !== "NEW_ENTITY" && <span className="rounded bg-violet-50 px-1 font-semibold text-violet-800" title="Not a new legal entity — shown for review">{r.eventType}</span>}
                    {r.marketingProtected && (
                      <span className="inline-flex items-center gap-0.5 rounded bg-red-50 px-1 font-semibold text-red-700" title="The registry marks this company as protected from marketing">
                        <ShieldAlert className="h-3 w-3" aria-hidden /> No marketing
                      </span>
                    )}
                  </div>
                </td>
                {show("registered") && <td className="whitespace-nowrap border-b border-ink-100 px-3 py-3 text-ink-800 group-hover:bg-ink-50/80">{r.registrationDay ? formatDay(r.registrationDay, { day: "numeric", month: "short", year: "numeric" }) : "—"}</td>}
                {show("industry") && (
                  <td className="max-w-[220px] border-b border-ink-100 px-3 py-3 group-hover:bg-ink-50/80">
                    <p className="line-clamp-2 text-ink-800">{r.industryLabel}</p>
                    {r.industryCode && <p className="text-xs tabular-nums text-ink-500">{r.industryCode}</p>}
                  </td>
                )}
                {show("location") && (
                  <td className="border-b border-ink-100 px-3 py-3 text-ink-800 group-hover:bg-ink-50/80">
                    {r.city || r.region ? (
                      <>
                        <p>{r.city ?? r.region}</p>
                        {r.region && r.region !== r.city && <p className="text-xs text-ink-500">{r.region}</p>}
                      </>
                    ) : (
                      <span className="text-xs italic text-ink-400">Not available</span>
                    )}
                  </td>
                )}
                <td className="border-b border-ink-100 px-3 py-3 group-hover:bg-ink-50/80">
                  <ContactValue kind="email" value={r.email} sourceKind={r.sources.email?.kind} source={r.sources.email?.source} missing={missingLabel("email", capabilities, r)} disabledActions={r.isDemo} emailActions={emailActions(r)} />
                </td>
                <td className="border-b border-ink-100 px-3 py-3 group-hover:bg-ink-50/80">
                  {r.phone || !r.mobile ? (
                    <ContactValue kind="phone" value={r.phone} sourceKind={r.sources.phone?.kind} source={r.sources.phone?.source} missing={missingLabel("phone", capabilities, r)} disabledActions={r.isDemo} />
                  ) : null}
                  {r.mobile && <ContactValue kind="mobile" value={r.mobile} sourceKind={r.sources.mobile?.kind} source={r.sources.mobile?.source} disabledActions={r.isDemo} className={r.phone ? "mt-2" : undefined} />}
                </td>
                <td className="border-b border-ink-100 px-3 py-3 group-hover:bg-ink-50/80">
                  <ContactValue kind="website" value={r.website} sourceKind={r.sources.website?.kind} source={r.sources.website?.source} missing={missingLabel("website", capabilities, r)} disabledActions={r.isDemo} />
                </td>
                {show("person") && (
                  <td className="max-w-[180px] border-b border-ink-100 px-3 py-3 group-hover:bg-ink-50/80">
                    {r.contactPerson ? (
                      <>
                        <p className="font-medium text-ink-900">{r.contactPerson.name}</p>
                        {r.contactPerson.role && <p className="text-xs text-ink-500">{r.contactPerson.role}</p>}
                      </>
                    ) : (
                      <span className="text-xs italic text-ink-400">{capabilities[r.countryCode]?.person ? "Not loaded yet" : "Not published by this registry"}</span>
                    )}
                  </td>
                )}
                {show("status") && (
                  <td className="border-b border-ink-100 px-3 py-3 group-hover:bg-ink-50/80">
                    <ContactStatus row={r} />
                  </td>
                )}
                {show("service") && (
                  <td className="max-w-[180px] border-b border-ink-100 px-3 py-3 text-xs group-hover:bg-ink-50/80">
                    {r.suggestedService ? (
                      <>
                        <p className="font-medium text-ink-800">{r.suggestedService}</p>
                        <p className="text-ink-500">Fit {r.fitScore}</p>
                      </>
                    ) : (
                      <span className="italic text-ink-400">No evidence-based suggestion yet</span>
                    )}
                  </td>
                )}
                {show("quality") && (
                  <td className="whitespace-nowrap border-b border-ink-100 px-3 py-3 group-hover:bg-ink-50/80">
                    <CompletenessStars value={r.completeness} />
                    {r.fullyContactable && <p className="mt-1 text-[11px] font-medium text-emerald-700">Fully contactable</p>}
                  </td>
                )}
                {show("lead") && (
                  <td className="border-b border-ink-100 px-3 py-3 group-hover:bg-ink-50/80">
                    <QualifyButtons companyId={r.id} relevance={r.relevance} saved={r.saved} stage={r.stage} canQualify={canQualify} onChange={(p) => patch(r.id, p)} />
                    <p className="mt-1 text-[11px] text-ink-500">
                      Score <span className="tabular-nums">{r.score}</span>
                    </p>
                  </td>
                )}
                <td className="whitespace-nowrap border-b border-ink-100 px-3 py-3 text-right group-hover:bg-ink-50/80">
                  <button type="button" onClick={() => setOpenIndex(i)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-ink-200 bg-white px-2.5 text-xs font-medium text-ink-700 hover:bg-ink-50" aria-label={`Quick view ${r.name}`}>
                    <Eye className="h-3.5 w-3.5" aria-hidden /> View
                  </button>
                </td>
              </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards with the actual contact values */}
      <ul className="space-y-3 md:hidden">
        {data.map((r, i) => (
          <li key={r.id} className={cn("rounded-xl border border-ink-200 bg-white p-4", r.relevance === "NOT_RELEVANT" && "opacity-60")}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-ink-900">{r.name}</p>
                <p className="text-xs text-ink-500">
                  {showCountry && `${r.countryCode} · `}
                  {r.registrationDay ? `Registered ${formatDay(r.registrationDay, { day: "numeric", month: "short" })}` : "Registration date not available"}
                  {r.registrationNumber && ` · ${r.registrationNumber}`}
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs text-ink-600">{r.industryLabel}</p>
                {r.isDemo && <span className="mt-1 inline-block rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-900">DEMO</span>}
              </div>
              <CompletenessStars value={r.completeness} />
            </div>
            <div className="mt-2">
              <ContactStatus row={r} compact />
            </div>
            <div className="mt-3 grid gap-3">
              <ContactValue kind="email" showLabel value={r.email} sourceKind={r.sources.email?.kind} missing={missingLabel("email", capabilities, r)} disabledActions={r.isDemo} emailActions={emailActions(r)} />
              <ContactValue kind="phone" showLabel value={r.phone ?? r.mobile} sourceKind={(r.phone ? r.sources.phone : r.sources.mobile)?.kind} missing={missingLabel("phone", capabilities, r)} disabledActions={r.isDemo} />
              <ContactValue kind="website" showLabel value={r.website} sourceKind={r.sources.website?.kind} missing={missingLabel("website", capabilities, r)} disabledActions={r.isDemo} />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-3">
              <QualifyButtons companyId={r.id} relevance={r.relevance} saved={r.saved} stage={r.stage} canQualify={canQualify} onChange={(p) => patch(r.id, p)} />
              <div className="flex gap-2">
                <button type="button" onClick={() => setOpenIndex(i)} className="inline-flex h-8 items-center rounded-lg border border-ink-200 px-2.5 text-xs font-medium text-ink-700">
                  Quick view
                </button>
                <Link href={r.href} className="inline-flex h-8 items-center rounded-lg bg-ink-900 px-2.5 text-xs font-medium text-white">
                  View company
                </Link>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <CompanyDrawer
        rows={data}
        index={openIndex}
        capabilities={capabilities}
        canQualify={canQualify}
        onIndexChange={setOpenIndex}
        onPatch={patch}
        emailContext={emailContext}
      />
    </>
  );
}
