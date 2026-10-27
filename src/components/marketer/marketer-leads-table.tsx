"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Building2, ChevronDown, CircleHelp, ExternalLink, Globe2, Inbox, LayoutGrid, Phone, Rocket, Search, SearchX, Sparkles, Users, X } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { CompanyType, CompanyTypeParam } from "@/lib/company-classification";
import { formatDay } from "@/lib/dates/country-time";
import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/intel/contact-value";
import { CompanyTypeTag } from "@/components/intel/company-type-tag";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/spinner";

export type MarketerLead = {
  id: string;
  companyName: string;
  contactPerson?: string;
  contactRole?: string;
  phone?: string;
  phoneDisplay?: string;
  website?: { href: string; display: string };
  countryCode?: string;
  sentAt: string;
  companyType: { value: CompanyType; reason?: string; manual: boolean };
  outreachStatus: OutreachStatus;
  outreachStatusAt?: string;
};
type OutreachStatus = "NOT_REACHED" | "MESSAGED" | "GOT_RESPONSE";
type Sort = "sent" | "company" | "contact" | "type";
type Dir = "asc" | "desc";
type Stats = { total: number; recent: number; withPhone: number; withWebsite: number; startup: number; established: number; review: number };
export type MarketerLeadPage = { items: MarketerLead[]; total: number; page: number; pageSize: number; pageCount: number; sort: Sort; dir: Dir; q: string; type: CompanyTypeParam | null; stats: Stats };

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "sent:desc", label: "Newest first" },
  { value: "sent:asc", label: "Oldest first" },
  { value: "company:asc", label: "Company A–Z" },
  { value: "company:desc", label: "Company Z–A" },
  { value: "contact:asc", label: "Contact person A–Z" },
  { value: "type:asc", label: "Company type" },
];

const TYPE_FILTERS: { key: CompanyTypeParam | null; label: string; stat: keyof Stats; Icon: typeof Rocket; on: string }[] = [
  { key: null, label: "All", stat: "total", Icon: LayoutGrid, on: "bg-ink-900 text-white border-ink-900" },
  { key: "startup", label: "Startup", stat: "startup", Icon: Rocket, on: "border-transparent bg-gradient-to-r from-fuchsia-600 to-violet-600 text-white" },
  { key: "established", label: "Established", stat: "established", Icon: Building2, on: "border-transparent bg-gradient-to-r from-teal-600 to-cyan-600 text-white" },
  { key: "review", label: "Needs Review", stat: "review", Icon: CircleHelp, on: "border-transparent bg-amber-500 text-white" },
];

const OUTREACH: { value: OutreachStatus; label: string; className: string; dot: string }[] = [
  { value: "NOT_REACHED", label: "Not reached", className: "border-ink-200 bg-ink-100 text-ink-700", dot: "bg-ink-400" },
  { value: "MESSAGED", label: "Messaged", className: "border-amber-200 bg-amber-50 text-amber-800", dot: "bg-amber-500" },
  { value: "GOT_RESPONSE", label: "Got response", className: "border-emerald-200 bg-emerald-50 text-emerald-800", dot: "bg-emerald-500" },
];

const nf = new Intl.NumberFormat("en-GB");
const sentLabel = (iso: string) => formatDay(iso.slice(0, 10), { day: "numeric", month: "short", year: "numeric" });

/**
 * Leads the Owner sent to the signed-in Digital Marketer: company, contact person, phone, website
 * and Company Type (the shared classification, identical to Company Intelligence). Every request
 * goes through /api/marketer/leads, which checks the permission and scopes the query to this
 * marketer server-side. Desktop/tablet: table; phones: stacked cards.
 */
export function MarketerLeadsTable({ initial }: { initial: MarketerLeadPage }) {
  const [data, setData] = useState<MarketerLeadPage>(initial);
  const [query, setQuery] = useState(initial.q);
  const [params, setParams] = useState({ q: initial.q, sort: initial.sort, dir: initial.dir, page: initial.page, type: initial.type });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef(true);
  const seq = useRef(0);

  const load = useCallback(async (p: typeof params) => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ sort: p.sort, dir: p.dir, page: String(p.page), ...(p.q && { q: p.q }), ...(p.type && { type: p.type }) });
    try {
      const res = await apiFetch<MarketerLeadPage>(`/api/marketer/leads?${qs}`);
      if (id !== seq.current) return; // a newer request superseded this one
      setData(res);
      try {
        window.history.replaceState(null, "", `?${qs}`);
      } catch {
        /* ignore */
      }
    } catch (e) {
      if (id !== seq.current) return;
      setError(e instanceof ApiError ? (e.status === 403 ? "Your access to client leads has changed. Reload the page or ask the Owner." : e.message) : "Could not load your leads.");
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void load(params);
  }, [params, load]);

  // Debounced search.
  useEffect(() => {
    if (query === params.q) return;
    const t = setTimeout(() => setParams((p) => ({ ...p, q: query.trim(), page: 1 })), 300);
    return () => clearTimeout(t);
  }, [query, params.q]);

  /** Local update after a saved status change (only that row). */
  const patchRow = (id: string, p: Partial<MarketerLead>) => setData((d) => ({ ...d, items: d.items.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
  const setSort = (sort: Sort, dir?: Dir) => setParams((p) => ({ ...p, sort, dir: dir ?? (p.sort === sort ? (p.dir === "asc" ? "desc" : "asc") : sort === "sent" ? "desc" : "asc"), page: 1 }));
  const items = data.items;
  const s = data.stats;
  const from = data.total ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = Math.min(data.total, data.page * data.pageSize);
  const filtered = !!params.q || !!params.type;

  return (
    <div className="space-y-5">
      {/* Hero + stats */}
      <section aria-label="Lead summary" className="relative overflow-hidden rounded-2xl border border-ink-200 bg-gradient-to-br from-white via-violet-50/40 to-teal-50/50 p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-gradient-to-br from-fuchsia-200/50 to-violet-200/30 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-48 w-48 rounded-full bg-gradient-to-br from-teal-200/40 to-cyan-100/30 blur-3xl" aria-hidden />
        <div className="relative">
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-violet-700">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> Marketing
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-900">Client leads</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-600">Companies the Owner sent to you. Copy a phone number with one tap, open the website, and use the Company Type to tailor your approach.</p>
          <dl className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <StatCard icon={Users} label="Active leads" value={s.total} tone="from-ink-800 to-ink-600" />
            <StatCard icon={Sparkles} label="Sent in the last 7 days" value={s.recent} tone="from-fuchsia-600 to-violet-600" />
            <StatCard icon={Phone} label="With phone number" value={s.withPhone} total={s.total} tone="from-violet-600 to-indigo-500" />
            <StatCard icon={Globe2} label="With website" value={s.withWebsite} total={s.total} tone="from-teal-600 to-cyan-500" />
          </dl>
          {s.total > 0 && <TypeMix stats={s} />}
        </div>
      </section>

      {/* Toolbar */}
      <div className="space-y-3 rounded-xl border border-ink-200 bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <label htmlFor="lead-search" className="sr-only">
              Search leads
            </label>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
            <input
              id="lead-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Company, contact, phone or website"
              className="h-10 w-full rounded-lg border border-ink-200 bg-white pl-9 pr-9 text-sm text-ink-900 transition-shadow placeholder:text-ink-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-400 hover:bg-ink-100 hover:text-ink-700" aria-label="Clear search">
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="lead-sort" className="text-sm text-ink-600">
              Sort
            </label>
            <select
              id="lead-sort"
              value={`${params.sort}:${params.dir}`}
              onChange={(e) => {
                const [srt, d] = e.target.value.split(":") as [Sort, Dir];
                setSort(srt, d);
              }}
              className="h-10 rounded-lg border border-ink-200 bg-white px-3 text-sm text-ink-800 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              {!SORT_OPTIONS.some((o) => o.value === `${params.sort}:${params.dir}`) && <option value={`${params.sort}:${params.dir}`}>Custom order</option>}
            </select>
          </div>
        </div>
        <div className="scroll-thin -mx-1 overflow-x-auto px-1">
          <div role="group" aria-label="Filter by company type" className="flex min-w-max gap-1.5">
            {TYPE_FILTERS.map(({ key, label, stat, Icon, on }) => {
              const active = params.type === key;
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setParams((p) => ({ ...p, type: key, page: 1 }))}
                  className={cn("inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500", active ? cn(on, "shadow-sm") : "border-ink-200 bg-white text-ink-700 hover:border-ink-300 hover:bg-ink-50")}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {label}
                  <span className={cn("rounded-full px-1.5 tabular-nums", active ? "bg-white/20" : "bg-ink-100 text-ink-600")}>{nf.format(s[stat])}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <p className="text-sm text-ink-500" aria-live="polite">
        {loading ? "Loading…" : data.total ? `Showing ${from}–${to} of ${data.total} lead${data.total === 1 ? "" : "s"}` : filtered ? "No matching leads" : ""}
      </p>

      {error && (
        <Alert tone="danger" title="Couldn't load leads" action={<Button size="sm" variant="outline" onClick={() => void load(params)}>Try again</Button>}>
          {error}
        </Alert>
      )}

      {!error && !loading && items.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={SearchX}
            title={params.q ? `No leads match “${params.q}”` : "No leads of this company type"}
            description="Try a company name, a contact person, part of a phone number or a website — or another company type."
            action={
              <Button size="sm" variant="outline" onClick={() => { setQuery(""); setParams((p) => ({ ...p, q: "", type: null, page: 1 })); }}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState icon={Inbox} title="No leads yet" description="Companies the Owner sends to you appear here with their contact person, phone number, website and company type." />
        )
      ) : (
        <>
          {/* Tablet / desktop */}
          <div className="scroll-thin hidden overflow-x-auto rounded-xl border border-ink-200 bg-white shadow-sm md:block">
            <table className="w-full min-w-[960px] table-fixed border-separate border-spacing-0 text-left text-sm">
              <caption className="sr-only">Client leads assigned to you</caption>
              <thead className="bg-gradient-to-r from-ink-50 via-violet-50/40 to-teal-50/40 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                <tr>
                  <SortableTh label="Company Name" active={params.sort === "company"} dir={params.dir} onClick={() => setSort("company")} className="w-[23%]" />
                  <SortableTh label="Contact Person" active={params.sort === "contact"} dir={params.dir} onClick={() => setSort("contact")} className="w-[16%]" />
                  <th scope="col" className="w-[18%] border-b border-ink-200 px-4 py-3">Phone Number</th>
                  <th scope="col" className="w-[15%] border-b border-ink-200 px-4 py-3">Website</th>
                  <SortableTh label="Company Type" active={params.sort === "type"} dir={params.dir} onClick={() => setSort("type")} className="w-[13%]" />
                  <th scope="col" className="w-[15%] border-b border-ink-200 px-4 py-3">Outreach Status</th>
                </tr>
              </thead>
              <tbody>
                {loading && !items.length
                  ? Array.from({ length: 5 }, (_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 6 }, (__, j) => (
                          <td key={j} className="border-b border-ink-100 px-4 py-3.5">
                            <Skeleton className="h-4 w-3/4" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : items.map((r, i) => (
                      <tr key={r.id} className={cn("group align-top transition-colors duration-150 hover:bg-violet-50/60", i % 2 === 1 ? "bg-slate-50/70" : "bg-white", loading && "opacity-60")}>
                        <td className="relative border-b border-ink-100 px-4 py-3">
                          <span className={cn("absolute inset-y-2 left-0 w-0.5 rounded-full opacity-0 transition-opacity group-hover:opacity-100", r.companyType.value === "STARTUP" ? "bg-violet-500" : r.companyType.value === "ESTABLISHED" ? "bg-teal-500" : "bg-amber-400")} aria-hidden />
                          <p className="break-words font-semibold text-ink-900">{r.companyName}</p>
                          <p className="mt-0.5 text-xs text-ink-500">
                            {r.countryCode && <span className="mr-1 rounded bg-ink-100 px-1 font-medium text-ink-600">{r.countryCode}</span>}
                            Sent {sentLabel(r.sentAt)}
                          </p>
                        </td>
                        <td className="border-b border-ink-100 px-4 py-3">
                          <ContactPerson r={r} />
                        </td>
                        <td className="border-b border-ink-100 px-4 py-3">
                          <PhoneCell r={r} />
                        </td>
                        <td className="border-b border-ink-100 px-4 py-3">
                          <WebsiteCell r={r} />
                        </td>
                        <td className="border-b border-ink-100 px-4 py-3.5">
                          <CompanyTypeTag short value={r.companyType.value} reason={r.companyType.reason} manual={r.companyType.manual} />
                        </td>
                        <td className="border-b border-ink-100 px-4 py-3">
                          <OutreachSelect lead={r} onSaved={(st, at) => patchRow(r.id, { outreachStatus: st, outreachStatusAt: at })} />
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>

          {/* Phones: stacked cards */}
          <ul className="space-y-3 md:hidden" aria-label="Client leads assigned to you">
            {(loading && !items.length ? [] : items).map((r) => (
              <li key={r.id} className={cn("relative overflow-hidden rounded-xl border border-ink-200 bg-white p-4 shadow-sm", loading && "opacity-60")}>
                <span className={cn("absolute inset-y-0 left-0 w-1", r.companyType.value === "STARTUP" ? "bg-gradient-to-b from-fuchsia-500 to-violet-500" : r.companyType.value === "ESTABLISHED" ? "bg-gradient-to-b from-teal-500 to-cyan-500" : "bg-amber-400")} aria-hidden />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words text-base font-semibold text-ink-900">{r.companyName}</p>
                    <p className="text-xs text-ink-500">
                      {r.countryCode && `${r.countryCode} · `}Sent {sentLabel(r.sentAt)}
                    </p>
                  </div>
                  <CompanyTypeTag short value={r.companyType.value} reason={r.companyType.reason} manual={r.companyType.manual} className="shrink-0" />
                </div>
                <dl className="mt-3 grid gap-3 text-sm">
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Outreach Status</dt>
                    <dd className="mt-1">
                      <OutreachSelect lead={r} touch onSaved={(st, at) => patchRow(r.id, { outreachStatus: st, outreachStatusAt: at })} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Contact Person</dt>
                    <dd className="mt-0.5">
                      <ContactPerson r={r} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Phone Number</dt>
                    <dd className="mt-0.5">
                      <PhoneCell r={r} touch />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Website</dt>
                    <dd className="mt-0.5">
                      <WebsiteCell r={r} />
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
            {loading && !items.length && Array.from({ length: 3 }, (_, i) => <li key={i}><Skeleton className="h-40 w-full rounded-xl" /></li>)}
          </ul>
        </>
      )}

      {data.pageCount > 1 && (
        <nav className="flex items-center justify-between gap-3" aria-label="Pagination">
          <Button size="sm" variant="outline" disabled={data.page <= 1 || loading} onClick={() => setParams((p) => ({ ...p, page: p.page - 1 }))}>
            Previous
          </Button>
          <span className="text-sm text-ink-600">
            Page {data.page} of {data.pageCount}
          </span>
          <Button size="sm" variant="outline" disabled={data.page >= data.pageCount || loading} onClick={() => setParams((p) => ({ ...p, page: p.page + 1 }))}>
            Next
          </Button>
        </nav>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, total, tone }: { icon: typeof Users; label: string; value: number; total?: number; tone: string }) {
  return (
    <div className="group rounded-xl border border-white/70 bg-white/80 px-4 py-3 shadow-sm backdrop-blur transition-all hover:-translate-y-0.5 hover:shadow-md">
      <dt className="flex items-center gap-2 text-xs font-medium text-ink-500">
        <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br text-white shadow-sm", tone)}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        {label}
      </dt>
      <dd className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-ink-900">{nf.format(value)}</span>
        {total !== undefined && <span className="text-xs tabular-nums text-ink-500">{total ? `${Math.round((value / total) * 100)}%` : "—"}</span>}
      </dd>
    </div>
  );
}

/** Share of startups / established companies / needs review among this marketer's leads. */
function TypeMix({ stats }: { stats: Stats }) {
  const parts = [
    { label: "Startup", n: stats.startup, bar: "bg-gradient-to-r from-fuchsia-500 to-violet-500", dot: "bg-violet-500" },
    { label: "Established", n: stats.established, bar: "bg-gradient-to-r from-teal-500 to-cyan-500", dot: "bg-teal-500" },
    { label: "Needs review", n: stats.review, bar: "bg-amber-400", dot: "bg-amber-400" },
  ];
  return (
    <div className="mt-4">
      <div className="flex h-2 overflow-hidden rounded-full bg-ink-100" role="img" aria-label={parts.map((p) => `${p.label}: ${p.n}`).join(", ")}>
        {parts.map((p) => (p.n ? <span key={p.label} className={cn("h-full transition-all", p.bar)} style={{ width: `${(p.n / stats.total) * 100}%` }} /> : null))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-600">
        {parts.map((p) => (
          <li key={p.label} className="inline-flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-full", p.dot)} aria-hidden />
            {p.label} <span className="font-semibold tabular-nums text-ink-800">{nf.format(p.n)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Outreach Status for one lead: a native select (keyboard and mobile friendly) styled as a
 * coloured badge. Saved immediately to that lead's assignment; reverted with a message if saving fails.
 */
function OutreachSelect({ lead, touch, onSaved }: { lead: MarketerLead; touch?: boolean; onSaved: (s: OutreachStatus, at: string) => void }) {
  const [value, setValue] = useState<OutreachStatus>(lead.outreachStatus);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = OUTREACH.find((o) => o.value === value) ?? OUTREACH[0]!;
  const id = `outreach-${lead.id}${touch ? "-m" : ""}`;

  async function change(next: OutreachStatus) {
    if (next === value) return;
    const previous = value;
    setValue(next);
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch<{ outreachStatus: OutreachStatus; outreachStatusAt: string }>(`/api/marketer/leads/${lead.id}`, { method: "PATCH", body: { outreachStatus: next } });
      onSaved(res.outreachStatus, res.outreachStatusAt);
    } catch (e) {
      setValue(previous);
      setError(e instanceof ApiError ? e.message : "Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <label htmlFor={id} className="sr-only">
        Outreach status for {lead.companyName}
      </label>
      <div className={cn("relative inline-flex max-w-full items-center rounded-full border shadow-sm transition-colors focus-within:ring-2 focus-within:ring-violet-500/40", current.className, saving && "opacity-70")}>
        <span className={cn("pointer-events-none absolute left-2.5 h-2 w-2 rounded-full", current.dot)} aria-hidden />
        <select
          id={id}
          value={value}
          disabled={saving}
          onChange={(e) => void change(e.target.value as OutreachStatus)}
          className={cn("w-full cursor-pointer appearance-none rounded-full bg-transparent pl-6 pr-7 text-xs font-semibold focus:outline-none disabled:cursor-wait", touch ? "h-10" : "h-8")}
        >
          {OUTREACH.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 opacity-70" aria-hidden />
      </div>
      {error && (
        <p role="alert" className="mt-1 text-[11px] text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function SortableTh({ label, active, dir, onClick, className }: { label: string; active: boolean; dir: Dir; onClick: () => void; className?: string }) {
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"} className={cn("border-b border-ink-200 px-2 py-1.5", className)}>
      <button type="button" onClick={onClick} className="inline-flex h-9 items-center gap-1 rounded-md px-2 uppercase tracking-wide transition-colors hover:bg-white/70 hover:text-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
        {label}
        <Icon className={cn("h-3.5 w-3.5", active ? "text-violet-600" : "text-ink-300")} aria-hidden />
      </button>
    </th>
  );
}

function ContactPerson({ r }: { r: MarketerLead }) {
  if (!r.contactPerson) return <span className="text-xs italic text-ink-400">Not available</span>;
  return (
    <>
      <p className="break-words font-medium text-ink-900">{r.contactPerson}</p>
      {r.contactRole && <p className="text-xs text-ink-500">{r.contactRole}</p>}
    </>
  );
}

function PhoneCell({ r, touch }: { r: MarketerLead; touch?: boolean }) {
  if (!r.phone) return <span className="text-xs italic text-ink-400">Not available</span>;
  const id = `lead-phone-${r.id}${touch ? "-m" : ""}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a id={id} href={`tel:${r.phone}`} className="select-all break-all font-medium tabular-nums text-ink-900 hover:text-violet-700">
        {r.phoneDisplay ?? r.phone}
      </a>
      <CopyButton value={r.phone} label={`phone number of ${r.companyName}`} selectTargetId={id} className={touch ? "h-10 min-w-10 px-3 text-xs" : "h-8 px-2"} />
    </div>
  );
}

function WebsiteCell({ r }: { r: MarketerLead }) {
  if (!r.website) return <span className="text-xs italic text-ink-400">Not available</span>;
  return (
    <a href={r.website.href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-full items-center gap-1 break-all font-medium text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
      <span className="truncate">{r.website.display}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}
