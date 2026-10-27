"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, BadgeCheck, Building2, CircleHelp, Copy, Download, ExternalLink, LayoutGrid, Mail, Phone, RefreshCw, Rocket, Search, SearchX, Trash2, X } from "lucide-react";
import type { DirectoryPage, DirectoryRow, IntelDetail } from "@/features/companies/intel";
import { apiFetch, ApiError } from "@/lib/api/client";
import { COMPANY_TYPE_LABELS, COMPANY_TYPES, type CompanyType } from "@/lib/company-classification";
import { CONTACT_STATUS_LABELS, CONTACT_STATUSES } from "@/lib/company-fields";
import { formatDay } from "@/lib/dates/country-time";
import { cn } from "@/lib/utils";
import { CopyButton } from "./contact-value";
import { CompanyTypeTag, ContactStatusTag } from "./company-type-tag";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Drawer } from "@/components/ui/overlay";
import { Skeleton, Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";

type Option = { value: string; label: string };
type Query = DirectoryPage["query"];
type TypeKey = "startup" | "established" | "review";

const nf = new Intl.NumberFormat("en-GB");
const day = (d?: string) => (d ? formatDay(d.slice(0, 10), { day: "numeric", month: "short", year: "numeric" }) : undefined);

const TYPE_TABS: { key: TypeKey | undefined; count: keyof DirectoryPage["counts"]; label: string; Icon: typeof Rocket; on: string; dot: string }[] = [
  { key: undefined, count: "all", label: "All", Icon: LayoutGrid, on: "bg-ink-900 text-white", dot: "bg-ink-400" },
  { key: "startup", count: "startup", label: "Startups", Icon: Rocket, on: "bg-gradient-to-r from-fuchsia-600 to-violet-600 text-white", dot: "bg-violet-500" },
  { key: "established", count: "established", label: "Established Companies", Icon: Building2, on: "bg-gradient-to-r from-teal-600 to-cyan-600 text-white", dot: "bg-teal-500" },
  { key: "review", count: "review", label: "Needs Review", Icon: CircleHelp, on: "bg-amber-500 text-white", dot: "bg-amber-500" },
];

function toParams(q: Partial<Query>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === "") continue;
    if ((k === "country" && v === "ALL") || (k === "sort" && v === "contact") || (k === "page" && v === 1) || k === "pageSize") continue;
    p.set(k, String(v));
  }
  return p;
}

/**
 * Company Intelligence directory for the team workspace: Startups / Established Companies tabs,
 * the same server-side filters and classification as the Owner workspace, a detail panel with the
 * source of every contact value, and permission-gated export / edit / delete. Desktop: table with
 * Company Type as the last column; phones: cards.
 */
export function CompanyDirectory({ initial, countries, industries, sorts, fixedType }: { initial: DirectoryPage; countries: { code: string; name: string; flag: string }[]; industries: Option[]; sorts: Option[]; /** Sidebar category pages: the category is locked and the tabs hidden. */ fixedType?: TypeKey }) {
  const [data, setData] = useState(initial);
  const [query, setQuery] = useState<Query>(initial.query);
  const [search, setSearch] = useState(initial.query.q ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const seq = useRef(0);
  const first = useRef(true);

  const load = useCallback(async (q: Query) => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    const qs = toParams(fixedType ? { ...q, type: undefined } : q);
    const apiQs = toParams(fixedType ? { ...q, type: fixedType } : q);
    try {
      const res = await apiFetch<DirectoryPage>(`/api/company-intel?${apiQs}`);
      if (id !== seq.current) return;
      setData(res);
      try {
        window.history.replaceState(null, "", `?${qs}`);
      } catch {
        /* ignore */
      }
    } catch (e) {
      if (id !== seq.current) return;
      setError(e instanceof ApiError ? (e.status === 403 ? "Your access to Company Intelligence has changed. Reload the page or ask the Owner." : e.message) : "Could not load companies.");
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [fixedType]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void load(query);
  }, [query, load]);

  useEffect(() => {
    if (search.trim() === (query.q ?? "")) return;
    const t = setTimeout(() => setQuery((q) => ({ ...q, q: search.trim() || undefined, page: 1 })), 350);
    return () => clearTimeout(t);
  }, [search, query.q]);

  const set = (changes: Partial<Query>) => setQuery((q) => ({ ...q, ...changes, page: changes.page ?? 1 }));
  const filtersOn = !!(query.q || query.industry || query.email || query.phone || query.contactStatus || (query.country && query.country !== "ALL"));
  const exportQs = toParams({ ...query, page: undefined, ...(fixedType && { type: fixedType }) });
  const items = data.items;
  const from = data.total ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = Math.min(data.total, data.page * data.pageSize);

  function patchRow(id: string, p: Partial<DirectoryRow>) {
    setData((d) => ({ ...d, items: d.items.map((r) => (r.id === id ? { ...r, ...p } : r)) }));
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-ink-200 bg-gradient-to-br from-white via-white to-teal-50/60 p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-gradient-to-br from-violet-200/40 to-teal-200/40 blur-2xl" aria-hidden />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-700">Company Intelligence</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-900">{fixedType === "startup" ? "Startups" : fixedType === "established" ? "Established companies" : "Startups & established companies"}</h1>
            <p className="mt-1 max-w-2xl text-sm text-ink-600">Research companies whose needs may fit our services, review public business contacts and their sources, and build outreach lists.</p>
          </div>
          {data.abilities.export && (
            <a href={`/api/company-intel/export?${exportQs}`} download className="inline-flex h-10 items-center gap-1.5 self-start rounded-lg border border-ink-200 bg-white px-3 text-sm font-medium text-ink-800 shadow-sm transition-colors hover:border-teal-300 hover:bg-teal-50 sm:self-auto">
              <Download className="h-4 w-4" aria-hidden /> Export CSV
            </a>
          )}
        </div>
        <dl className="relative mt-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="Companies in view" value={data.stats.total} accent="from-ink-800 to-ink-600" />
          <Stat label="Business email" value={data.stats.withEmail} total={data.stats.total} accent="from-brand-600 to-sky-500" />
          <Stat label="Business phone" value={data.stats.withPhone} total={data.stats.total} accent="from-violet-600 to-fuchsia-500" />
          <Stat label="Verified contact" value={data.stats.verified} total={data.stats.total} accent="from-emerald-600 to-teal-500" />
        </dl>
      </div>

      {/* Category tabs (the sidebar category pages lock the category instead) */}
      {!fixedType && (
      <nav aria-label="Company category" className="scroll-thin -mx-1 overflow-x-auto px-1">
        <ul className="flex min-w-max gap-1 rounded-xl border border-ink-200 bg-white p-1">
          {TYPE_TABS.map(({ key, count, label, Icon, on, dot }) => {
            const active = query.type === key;
            return (
              <li key={label}>
                <button type="button" onClick={() => set({ type: key })} aria-pressed={active} className={cn("flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500", active ? cn(on, "shadow-sm") : "text-ink-600 hover:bg-ink-50 hover:text-ink-900")}>
                  <Icon className="h-4 w-4" aria-hidden />
                  {label}
                  <span className={cn("inline-flex min-w-6 items-center justify-center gap-1 rounded-full px-1.5 text-xs tabular-nums", active ? "bg-white/20" : "bg-ink-100 text-ink-700")}>
                    {!active && <span className={cn("h-1.5 w-1.5 rounded-full", dot)} aria-hidden />}
                    {nf.format(data.counts[count])}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      )}

      {/* Filters */}
      <div className="space-y-2 rounded-xl border border-ink-200 bg-white p-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <label htmlFor="dir-search" className="sr-only">
              Search companies
            </label>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
            <input id="dir-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Company, registration number, email, phone, website, city…" className="h-10 w-full rounded-lg border border-ink-200 bg-white pl-9 pr-9 text-sm placeholder:text-ink-400 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20" />
            {search && (
              <button type="button" onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-400 hover:bg-ink-100 hover:text-ink-700" aria-label="Clear search">
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
          <FilterSelect label="Sort" value={query.sort} onChange={(v) => set({ sort: v as Query["sort"] })} options={sorts} />
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
          <FilterSelect label="Country" value={query.country ?? "ALL"} onChange={(v) => set({ country: v })} options={[{ value: "ALL", label: "All countries" }, ...countries.map((c) => ({ value: c.code, label: `${c.flag} ${c.name}` }))]} />
          <FilterSelect label="Industry" value={query.industry ?? ""} onChange={(v) => set({ industry: (v || undefined) as Query["industry"] })} options={[{ value: "", label: "All industries" }, ...industries]} />
          <FilterSelect label="Email" value={query.email ?? ""} onChange={(v) => set({ email: (v || undefined) as Query["email"] })} options={[{ value: "", label: "Any" }, { value: "yes", label: "Has business email" }, { value: "no", label: "No email" }]} />
          <FilterSelect label="Phone" value={query.phone ?? ""} onChange={(v) => set({ phone: (v || undefined) as Query["phone"] })} options={[{ value: "", label: "Any" }, { value: "yes", label: "Has business phone" }, { value: "no", label: "No phone" }]} />
          <FilterSelect label="Contact status" value={query.contactStatus ?? ""} onChange={(v) => set({ contactStatus: (v || undefined) as Query["contactStatus"] })} options={[{ value: "", label: "Any status" }, ...CONTACT_STATUSES.map((s) => ({ value: s, label: CONTACT_STATUS_LABELS[s] }))]} />
        </div>
        {filtersOn && (
          <button type="button" onClick={() => { setSearch(""); setQuery((q) => ({ ...q, q: undefined, industry: undefined, email: undefined, phone: undefined, contactStatus: undefined, country: "ALL", page: 1 })); }} className="inline-flex h-8 items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink-800">
            <X className="h-3.5 w-3.5" aria-hidden /> Clear filters
          </button>
        )}
      </div>

      <p className="text-sm text-ink-500" aria-live="polite">
        {loading ? "Loading…" : data.total ? `Showing ${nf.format(from)}–${nf.format(to)} of ${nf.format(data.total)}` : ""}
      </p>

      {error && (
        <Alert tone="danger" title="Couldn't load companies" action={<Button size="sm" variant="outline" onClick={() => void load(query)}>Try again</Button>}>
          {error}
        </Alert>
      )}

      {!error && !loading && items.length === 0 ? (
        filtersOn || query.type || fixedType ? (
          <EmptyState icon={SearchX} title="No companies match" description="Try another category, country or filter. Companies without public contacts stay listed — only the filters hide them." />
        ) : (
          <EmptyState icon={Building2} title="No companies yet" description="Companies appear here as registry sources are synchronised." />
        )
      ) : (
        <>
          {/* Desktop / tablet */}
          <div className="scroll-thin hidden overflow-x-auto rounded-xl border border-ink-200 bg-white shadow-sm md:block">
            <table className="w-full min-w-[980px] border-separate border-spacing-0 text-left text-sm">
              <caption className="sr-only">Companies</caption>
              <thead className="sticky top-0 z-10 bg-gradient-to-b from-ink-50 to-ink-50/80 text-[11px] font-semibold uppercase tracking-wide text-ink-500 backdrop-blur">
                <tr>
                  <th scope="col" className="w-[28%] border-b border-ink-200 px-4 py-3">Company</th>
                  <th scope="col" className="border-b border-ink-200 px-4 py-3">Industry</th>
                  <th scope="col" className="border-b border-ink-200 px-4 py-3">Business contact</th>
                  <th scope="col" className="border-b border-ink-200 px-4 py-3">Website</th>
                  <th scope="col" className="border-b border-ink-200 px-4 py-3">Contact status</th>
                  <th scope="col" aria-sort={query.sort === "type" ? "descending" : "none"} className="border-b border-ink-200 px-2 py-1.5">
                    <button type="button" onClick={() => set({ sort: query.sort === "type" ? "contact" : "type" })} className={cn("inline-flex h-9 items-center gap-1 rounded-md px-2 uppercase tracking-wide hover:bg-ink-100 hover:text-ink-800", query.sort === "type" && "text-teal-700")}>
                      Company Type
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading && !items.length
                  ? Array.from({ length: 6 }, (_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 6 }, (__, j) => (
                          <td key={j} className="border-b border-ink-100 px-4 py-4">
                            <Skeleton className="h-4 w-3/4" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : items.map((r) => (
                      <tr key={r.id} className={cn("group align-top transition-colors hover:bg-teal-50/40", loading && "opacity-60")}>
                        <td className="border-b border-ink-100 px-4 py-3">
                          <button type="button" onClick={() => setOpenId(r.id)} className="text-left font-semibold text-ink-900 decoration-teal-400 decoration-2 underline-offset-2 hover:text-teal-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
                            {r.name}
                          </button>
                          <p className="mt-0.5 text-xs text-ink-500">
                            <span className="font-medium text-ink-600">{r.countryCode}</span>
                            {r.city && ` · ${r.city}`}
                            {r.foundedDay && ` · since ${r.foundedDay.slice(0, 4)}`}
                            {r.employees !== undefined && ` · ${nf.format(r.employees)} employees`}
                          </p>
                        </td>
                        <td className="max-w-[200px] border-b border-ink-100 px-4 py-3 text-ink-700">
                          <p className="line-clamp-2">{r.industry}</p>
                        </td>
                        <td className="border-b border-ink-100 px-4 py-3">
                          <ContactLines r={r} />
                        </td>
                        <td className="max-w-[180px] border-b border-ink-100 px-4 py-3">
                          {r.website ? (
                            <a href={r.website.href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-full items-center gap-1 font-medium text-brand-700 hover:underline">
                              <span className="truncate">{r.website.display}</span>
                              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              <span className="sr-only">(opens in a new tab)</span>
                            </a>
                          ) : (
                            <span className="text-xs italic text-ink-400">Not found</span>
                          )}
                        </td>
                        <td className="border-b border-ink-100 px-4 py-3">
                          <ContactStatusTag value={r.contactStatus} />
                        </td>
                        <td className="border-b border-ink-100 px-4 py-3">
                          <CompanyTypeTag value={r.type} reason={r.typeReason} manual={r.manualType} />
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>

          {/* Phones */}
          <ul className="space-y-3 md:hidden" aria-label="Companies">
            {(loading && !items.length ? [] : items).map((r) => (
              <li key={r.id} className={cn("rounded-xl border border-ink-200 bg-white p-4 shadow-sm", loading && "opacity-60")}>
                <div className="flex items-start justify-between gap-2">
                  <button type="button" onClick={() => setOpenId(r.id)} className="min-w-0 text-left">
                    <p className="break-words text-base font-semibold text-ink-900">{r.name}</p>
                    <p className="text-xs text-ink-500">
                      {r.countryCode}
                      {r.city && ` · ${r.city}`}
                      {r.foundedDay && ` · since ${r.foundedDay.slice(0, 4)}`}
                    </p>
                  </button>
                  <CompanyTypeTag value={r.type} reason={r.typeReason} manual={r.manualType} className="shrink-0" />
                </div>
                <p className="mt-1 line-clamp-1 text-xs text-ink-600">{r.industry}</p>
                <div className="mt-3 space-y-2">
                  <ContactLines r={r} touch />
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-ink-100 pt-3">
                  <ContactStatusTag value={r.contactStatus} />
                  <button type="button" onClick={() => setOpenId(r.id)} className="inline-flex h-9 items-center rounded-lg bg-ink-900 px-3 text-xs font-medium text-white">
                    Details
                  </button>
                </div>
              </li>
            ))}
            {loading && !items.length && Array.from({ length: 3 }, (_, i) => <li key={i}><Skeleton className="h-40 w-full rounded-xl" /></li>)}
          </ul>
        </>
      )}

      {data.pageCount > 1 && (
        <nav className="flex items-center justify-between gap-3" aria-label="Pagination">
          <Button size="sm" variant="outline" disabled={data.page <= 1 || loading} onClick={() => set({ page: data.page - 1 })}>
            Previous
          </Button>
          <span className="text-sm text-ink-600">
            Page {data.page} of {nf.format(data.pageCount)}
          </span>
          <Button size="sm" variant="outline" disabled={data.page >= data.pageCount || loading} onClick={() => set({ page: data.page + 1 })}>
            Next
          </Button>
        </nav>
      )}

      <p className="text-xs text-ink-500">
        Only publicly available business contact details are shown, each with its source. Nothing is generated or guessed: a missing email means none was found publicly, not that none exists. Before outreach, follow the marketing rules of the company&apos;s country (e.g. GDPR / ePrivacy in Europe, CAN-SPAM in the US, the Spam Act in Australia, CASL in Canada) and honour every opt-out.
      </p>

      <DetailDrawer id={openId} abilities={data.abilities} onClose={() => setOpenId(null)} onChanged={(id, p) => patchRow(id, p)} onDeleted={(id) => { setOpenId(null); setData((d) => ({ ...d, items: d.items.filter((r) => r.id !== id), total: Math.max(0, d.total - 1) })); }} />
    </div>
  );
}

function Stat({ label, value, total, accent }: { label: string; value: number; total?: number; accent: string }) {
  return (
    <div className="rounded-xl border border-ink-200/80 bg-white/80 px-4 py-3 shadow-sm backdrop-blur transition-shadow hover:shadow">
      <dt className="flex items-center gap-2 text-xs font-medium text-ink-500">
        <span className={cn("h-2 w-2 rounded-full bg-gradient-to-br", accent)} aria-hidden />
        {label}
      </dt>
      <dd className="mt-0.5 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-ink-900">{nf.format(value)}</span>
        {total !== undefined && <span className="text-xs tabular-nums text-ink-500">{total ? `${Math.round((value / total) * 100)}%` : "—"}</span>}
      </dd>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Option[] }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-10 min-w-0 rounded-lg border border-ink-200 bg-white px-2 text-sm font-normal normal-case tracking-normal text-ink-900 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ContactLines({ r, touch }: { r: DirectoryRow; touch?: boolean }) {
  if (r.marketingProtected) return <p className="text-xs font-medium text-red-700">Withheld — marketing restricted</p>;
  if (!r.email && !r.phone) return <span className="text-xs italic text-ink-400">No public email or phone found</span>;
  return (
    <div className="space-y-1.5">
      {r.email && (
        <p className="flex min-w-0 items-center gap-1.5">
          <Mail className="h-3.5 w-3.5 shrink-0 text-brand-500" aria-hidden />
          <a href={`mailto:${r.email}`} className="truncate text-ink-900 hover:text-brand-700 hover:underline">
            {r.email}
          </a>
          <CopyButton value={r.email} label={`email of ${r.name}`} iconOnly className={touch ? "h-9 px-2" : undefined} />
        </p>
      )}
      {r.phone && (
        <p className="flex items-center gap-1.5">
          <Phone className="h-3.5 w-3.5 shrink-0 text-violet-500" aria-hidden />
          <a href={`tel:${r.phone}`} className="tabular-nums text-ink-900 hover:text-brand-700 hover:underline">
            {r.phoneDisplay}
          </a>
          <CopyButton value={r.phone} label={`phone number of ${r.name}`} iconOnly className={touch ? "h-9 px-2" : undefined} />
        </p>
      )}
    </div>
  );
}

function DetailDrawer({ id, abilities, onClose, onChanged, onDeleted }: { id: string | null; abilities: DirectoryPage["abilities"]; onClose: () => void; onChanged: (id: string, p: Partial<DirectoryRow>) => void; onDeleted: (id: string) => void }) {
  const [detail, setDetail] = useState<IntelDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the panel when another company is opened
    setDetail(null);
    setError(null);
    apiFetch<IntelDetail>(`/api/company-intel/${id}`)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : "Could not load this company."));
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function changeType(value: CompanyType | "AUTO") {
    if (!detail) return;
    setBusy("type");
    try {
      const res = await apiFetch<{ value: CompanyType; reason: string; manual: boolean }>(`/api/company-intel/${detail.id}/type`, { body: { value } });
      setDetail({ ...detail, type: res.value, typeLabel: COMPANY_TYPE_LABELS[res.value], typeReason: res.reason, manualType: res.manual });
      onChanged(detail.id, { type: res.value, typeReason: res.reason, manualType: res.manual });
      toast.success(`Company Type: ${COMPANY_TYPE_LABELS[res.value]}${res.manual ? "" : " (automatic)"}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not change the Company Type.");
    } finally {
      setBusy(null);
    }
  }

  async function refresh() {
    if (!detail) return;
    setBusy("refresh");
    try {
      await apiFetch(`/api/company-intel/${detail.id}/refresh`, { body: {} });
      toast.success("Contact research queued — new public contacts appear here when found.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not queue research.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!detail || !confirm(`Delete ${detail.name}? Its contact data is removed and its email addresses are added to the suppression list. This can't be undone.`)) return;
    setBusy("delete");
    try {
      await apiFetch(`/api/company-intel/${detail.id}`, { method: "DELETE" });
      toast.success(`${detail.name} was deleted.`);
      onDeleted(detail.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not delete this company.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Drawer open={!!id} onClose={onClose} side="right" label="Company details" className="w-[34rem] max-w-[100vw]">
      <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
        <p className="text-sm font-semibold text-ink-900">Company details</p>
        <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100" aria-label="Close">
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>
      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {!detail && !error && (
          <div className="space-y-3">
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-28 w-full" />
          </div>
        )}
        {detail && (
          <>
            <div>
              <h2 className="text-lg font-semibold text-ink-900">{detail.name}</h2>
              <p className="text-sm text-ink-500">{[detail.countryCode, detail.city, detail.registrationNumber && `Reg. ${detail.registrationNumber}`].filter(Boolean).join(" · ")}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <CompanyTypeTag value={detail.type} reason={detail.typeReason} manual={detail.manualType} />
                <ContactStatusTag value={detail.contactStatus} />
              </div>
              {detail.typeReason && <p className="mt-2 text-xs text-ink-600">{detail.typeReason}{detail.manualType ? " (manual decision)" : ""}</p>}
              {detail.typeBasis.length > 0 && !detail.manualType && <p className="mt-1 text-[11px] text-ink-500">Evidence: {detail.typeBasis.join(" · ")}</p>}
            </div>

            {detail.withheldReason && (
              <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Contact details withheld: {detail.withheldReason}
              </p>
            )}

            <Section title="Business email">
              {detail.emails.length ? detail.emails.map((e) => <ContactEvidence key={e.value} c={e} icon={Mail} />) : <Missing text={detail.withheldReason ? "Withheld" : detail.contactStatus === "PENDING" ? "Not researched yet" : "No public business email found"} />}
            </Section>
            <Section title="Business phone">
              {detail.phones.length ? detail.phones.map((p) => <ContactEvidence key={p.value} c={p} icon={Phone} />) : <Missing text={detail.withheldReason ? "Withheld" : "No public business phone found"} />}
            </Section>

            <Section title="Company">
              <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
                <Item label="Industry" value={detail.industry} />
                <Item label="Contact person" value={detail.contactPerson ? `${detail.contactPerson.name}${detail.contactPerson.role ? ` — ${detail.contactPerson.role}` : ""}` : undefined} />
                <Item label="Website" value={detail.website ? <a href={detail.website.href} target="_blank" rel="noopener noreferrer nofollow" className="text-brand-700 hover:underline">{detail.website.display}</a> : undefined} />
                <Item label="Address" value={detail.address} />
                <Item label="Founded" value={day(detail.foundedDay)} />
                <Item label="Company size" value={detail.employees !== undefined ? `${nf.format(detail.employees)} employees (registry)` : undefined} />
                <Item label="Legal form" value={detail.legalForm} />
                <Item label="Status" value={detail.status} />
              </dl>
              {detail.description && <p className="mt-2 text-sm text-ink-700">{detail.description}</p>}
              {detail.socialLinks.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {detail.socialLinks.map((s) => (
                    <li key={s.link!.href}>
                      <a href={s.link!.href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 rounded-full border border-ink-200 px-2.5 py-1 text-xs text-ink-700 hover:bg-ink-50">
                        {s.network} <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {detail.duplicates.length > 0 && (
              <Section title="Possible duplicates">
                <ul className="space-y-1 text-sm">
                  {detail.duplicates.map((d) => (
                    <li key={d.id} className="flex items-center gap-2">
                      <Copy className="h-3.5 w-3.5 text-amber-600" aria-hidden />
                      <span className="font-medium text-ink-800">{d.name}</span>
                      <span className="text-xs text-ink-500">
                        {d.countryCode} · {d.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title="Source">
              <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
                <Item label="Registry" value={detail.sourceUrl ? <a href={detail.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-brand-700 hover:underline">{detail.sourceName ?? "Source record"}</a> : detail.sourceName} />
                <Item label="Last updated" value={day(detail.updatedAt)} />
                <Item label="Contacts verified" value={day(detail.contactLastVerifiedAt) ?? "Not verified yet"} />
                <Item label="Collected via" value={detail.discoveredVia === "ESTABLISHED_COLLECTION" ? "Established-company collection" : "New-registration feed"} />
              </dl>
            </Section>

            {(abilities.edit || abilities.delete) && (
              <Section title="Actions">
                {abilities.edit && (
                  <div className="space-y-3">
                    <label className="flex flex-col gap-1 text-xs font-medium text-ink-600">
                      Company Type
                      <span className="flex gap-2">
                        <select disabled={busy !== null} value={detail.manualType ? detail.type : "AUTO"} onChange={(e) => void changeType(e.target.value as CompanyType | "AUTO")} className="h-10 flex-1 rounded-lg border border-ink-200 bg-white px-2 text-sm font-normal text-ink-900">
                          <option value="AUTO">Automatic ({COMPANY_TYPE_LABELS[detail.type]})</option>
                          {COMPANY_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {COMPANY_TYPE_LABELS[t]} (manual)
                            </option>
                          ))}
                        </select>
                        {busy === "type" && <Spinner className="h-5 w-5 self-center" label="Saving" />}
                      </span>
                    </label>
                    <Button variant="outline" size="sm" loading={busy === "refresh"} disabled={busy !== null} onClick={() => void refresh()}>
                      <RefreshCw className="h-4 w-4" aria-hidden /> Refresh public contacts
                    </Button>
                  </div>
                )}
                {abilities.delete && (
                  <Button variant="danger" size="sm" className="mt-3" loading={busy === "delete"} disabled={busy !== null} onClick={() => void remove()}>
                    <Trash2 className="h-4 w-4" aria-hidden /> Delete record
                  </Button>
                )}
              </Section>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500">{title}</h3>
      {children}
    </section>
  );
}

function Item({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <>
      <dt className="text-ink-500">{label}</dt>
      <dd className="min-w-0 break-words text-ink-900">{value ?? <span className="italic text-ink-400">Not publicly available</span>}</dd>
    </>
  );
}

function Missing({ text }: { text: string }) {
  return <p className="text-sm italic text-ink-400">{text}</p>;
}

function ContactEvidence({ c, icon: Icon }: { c: IntelDetail["emails"][number]; icon: typeof Mail }) {
  const href = c.kind === "Business inbox" || c.kind === "Named person" ? `mailto:${c.value}` : `tel:${c.value}`;
  return (
    <div className="mb-2 rounded-lg border border-ink-200 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Icon className="h-4 w-4 text-ink-400" aria-hidden />
        <a href={href} className="break-all font-medium text-ink-900 hover:text-brand-700 hover:underline">
          {c.display}
        </a>
        <CopyButton value={c.value} label={c.display} iconOnly />
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", c.kind === "Named person" ? "bg-violet-50 text-violet-700" : "bg-ink-100 text-ink-600")}>{c.kind}</span>
        {c.needsReview && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">Needs review</span>}
      </div>
      {c.personName && <p className="mt-1 text-xs text-ink-700">{c.personName}{c.role ? ` — ${c.role}` : ""}</p>}
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-500">
        {c.verification && (
          <span className="inline-flex items-center gap-0.5">
            <BadgeCheck className="h-3 w-3" aria-hidden /> {c.verification}
          </span>
        )}
        <span>
          {c.sourceKind}: {c.sourceUrl ? <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-brand-700 hover:underline">{c.source}</a> : c.source}
        </span>
        {c.lastSeen && <span>· {day(c.lastSeen)}</span>}
      </p>
    </div>
  );
}
