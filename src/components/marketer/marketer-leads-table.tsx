"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, Inbox, Search, SearchX, X } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { formatDay } from "@/lib/dates/country-time";
import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/intel/contact-value";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/spinner";

export type MarketerLead = {
  id: string;
  companyName: string;
  contactPerson?: string;
  contactRole?: string;
  phone?: string;
  website?: { href: string; display: string };
  countryCode?: string;
  sentAt: string;
};
type Sort = "sent" | "company" | "contact";
type Dir = "asc" | "desc";
export type MarketerLeadPage = { items: MarketerLead[]; total: number; page: number; pageSize: number; pageCount: number; sort: Sort; dir: Dir; q: string };

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "sent:desc", label: "Newest first" },
  { value: "sent:asc", label: "Oldest first" },
  { value: "company:asc", label: "Company A–Z" },
  { value: "company:desc", label: "Company Z–A" },
  { value: "contact:asc", label: "Contact person A–Z" },
];

const sentLabel = (iso: string) => formatDay(iso.slice(0, 10), { day: "numeric", month: "short", year: "numeric" });

/**
 * Leads the Owner sent to the signed-in Digital Marketer: company, contact person, phone and
 * website. Every request goes through /api/marketer/leads, which checks the permission and
 * scopes the query to this marketer server-side. Desktop/tablet: table; phones: stacked rows.
 */
export function MarketerLeadsTable({ initial }: { initial: MarketerLeadPage }) {
  const [data, setData] = useState<MarketerLeadPage>(initial);
  const [query, setQuery] = useState(initial.q);
  const [params, setParams] = useState({ q: initial.q, sort: initial.sort, dir: initial.dir, page: initial.page });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef(true);
  const seq = useRef(0);

  const load = useCallback(async (p: typeof params) => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ sort: p.sort, dir: p.dir, page: String(p.page), ...(p.q && { q: p.q }) });
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

  const setSort = (sort: Sort, dir?: Dir) => setParams((p) => ({ ...p, sort, dir: dir ?? (p.sort === sort ? (p.dir === "asc" ? "desc" : "asc") : sort === "sent" ? "desc" : "asc"), page: 1 }));
  const items = data.items;
  const from = data.total ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = Math.min(data.total, data.page * data.pageSize);

  return (
    <div className="space-y-4">
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
            className="h-10 w-full rounded-lg border border-ink-200 bg-white pl-9 pr-9 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
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
              const [s, d] = e.target.value.split(":") as [Sort, Dir];
              setSort(s, d);
            }}
            className="h-10 rounded-lg border border-ink-200 bg-white px-3 text-sm text-ink-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-sm text-ink-500" aria-live="polite">
        {loading ? "Loading…" : data.total ? `Showing ${from}–${to} of ${data.total} lead${data.total === 1 ? "" : "s"}` : params.q ? "No matching leads" : ""}
      </p>

      {error && (
        <Alert tone="danger" title="Couldn't load leads" action={<Button size="sm" variant="outline" onClick={() => void load(params)}>Try again</Button>}>
          {error}
        </Alert>
      )}

      {!error && !loading && items.length === 0 ? (
        params.q ? (
          <EmptyState icon={SearchX} title={`No leads match “${params.q}”`} description="Try a company name, a contact person, part of a phone number or a website." action={<Button size="sm" variant="outline" onClick={() => setQuery("")}>Clear search</Button>} />
        ) : (
          <EmptyState icon={Inbox} title="No leads yet" description="Companies the Owner sends to you appear here with their contact person, phone number and website." />
        )
      ) : (
        <>
          {/* Tablet / desktop */}
          <div className="hidden overflow-hidden rounded-xl border border-ink-200 bg-white md:block">
            <table className="w-full table-fixed border-separate border-spacing-0 text-left text-sm">
              <caption className="sr-only">Client leads assigned to you</caption>
              <thead className="bg-ink-50 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                <tr>
                  <SortableTh label="Company Name" active={params.sort === "company"} dir={params.dir} onClick={() => setSort("company")} className="w-[32%]" />
                  <SortableTh label="Contact Person" active={params.sort === "contact"} dir={params.dir} onClick={() => setSort("contact")} className="w-[22%]" />
                  <th scope="col" className="w-[24%] border-b border-ink-200 px-4 py-3">Phone Number</th>
                  <th scope="col" className="w-[22%] border-b border-ink-200 px-4 py-3">Website</th>
                </tr>
              </thead>
              <tbody>
                {loading && !items.length
                  ? Array.from({ length: 5 }, (_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 4 }, (__, j) => (
                          <td key={j} className="border-b border-ink-100 px-4 py-3.5">
                            <Skeleton className="h-4 w-3/4" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : items.map((r) => (
                      <tr key={r.id} className={cn("align-top hover:bg-ink-50/70", loading && "opacity-60")}>
                        <td className="border-b border-ink-100 px-4 py-3">
                          <p className="break-words font-semibold text-ink-900">{r.companyName}</p>
                          <p className="mt-0.5 text-xs text-ink-500">
                            {r.countryCode && <span className="mr-1 font-medium text-ink-600">{r.countryCode}</span>}
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
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>

          {/* Phones: stacked rows */}
          <ul className="space-y-3 md:hidden" aria-label="Client leads assigned to you">
            {(loading && !items.length ? [] : items).map((r) => (
              <li key={r.id} className={cn("rounded-xl border border-ink-200 bg-white p-4", loading && "opacity-60")}>
                <p className="break-words text-base font-semibold text-ink-900">{r.companyName}</p>
                <p className="text-xs text-ink-500">
                  {r.countryCode && `${r.countryCode} · `}Sent {sentLabel(r.sentAt)}
                </p>
                <dl className="mt-3 grid gap-3 text-sm">
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
            {loading && !items.length && Array.from({ length: 3 }, (_, i) => <li key={i}><Skeleton className="h-36 w-full rounded-xl" /></li>)}
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

function SortableTh({ label, active, dir, onClick, className }: { label: string; active: boolean; dir: Dir; onClick: () => void; className?: string }) {
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"} className={cn("border-b border-ink-200 px-2 py-1.5", className)}>
      <button type="button" onClick={onClick} className="inline-flex h-9 items-center gap-1 rounded-md px-2 uppercase tracking-wide hover:bg-ink-100 hover:text-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
        {label}
        <Icon className={cn("h-3.5 w-3.5", active ? "text-brand-600" : "text-ink-300")} aria-hidden />
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
      <span id={id} className="select-all break-all font-medium tabular-nums text-ink-900">
        {r.phone}
      </span>
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
