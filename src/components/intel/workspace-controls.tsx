"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CloudDownload, Download, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { CONTACT_FILTER_LABELS, PRIMARY_CONTACT_FILTERS, RELEVANCE_LABELS, RELEVANCE_VALUES, RESEARCH_STATUS_LABELS } from "@/lib/company-fields";
import { DATE_PRESETS, DATE_PRESET_LABELS } from "@/lib/dates/country-time";
import { formatRelative } from "@/lib/utils/format";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

function useParamsNav() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const go = (changes: Record<string, string | null | undefined>, opts: { keepPage?: boolean } = {}) => {
    const params = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === undefined || v === "") params.delete(k);
      else params.set(k, v);
    }
    if (!opts.keepPage) params.delete("page");
    router.push(`${pathname}${params.size ? `?${params.toString()}` : ""}`, { scroll: false });
  };
  return { go, search, pathname, router };
}

/** Persist the dashboard country context (non-sensitive UI preference). */
function rememberCountry(code: string) {
  document.cookie = `et_country=${code}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

export type CountryOptionLite = { code: string; slug: string; name: string; flag: string; today: number | null };

/** Country + date selectors that sit in the page header. */
export function CountryDateBar({ countries, current, fixedPath, range, from, to, allowAll = true, defaultRange = "today" }: { countries: CountryOptionLite[]; current: string; fixedPath?: boolean; range: string; from?: string; to?: string; allowAll?: boolean; defaultRange?: string }) {
  const { go, search, router } = useParamsNav();
  const [custom, setCustom] = useState(range === "custom");
  const [cFrom, setCFrom] = useState(from ?? "");
  const [cTo, setCTo] = useState(to ?? "");

  function chooseCountry(code: string) {
    rememberCountry(code);
    if (fixedPath) {
      const params = new URLSearchParams(search.toString());
      params.delete("page");
      router.push(`/dashboard/companies/${code === "ALL" ? "all" : code.toLowerCase()}${params.size ? `?${params}` : ""}`);
    } else go({ country: code });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Country</span>
        <select value={current} onChange={(e) => chooseCountry(e.target.value)} className="h-10 min-w-48 rounded-lg border border-ink-200 bg-white px-3 text-sm font-medium text-ink-900 shadow-soft focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100">
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.flag} {c.name}
              {c.today !== null ? ` — today: ${c.today}` : ""}
            </option>
          ))}
          {allowAll && <option value="ALL">🌍 All countries</option>}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Registration date</span>
        <select
          value={range}
          onChange={(e) => {
            const v = e.target.value;
            setCustom(v === "custom");
            if (v !== "custom") go({ range: v === defaultRange ? null : v, from: null, to: null });
          }}
          className="h-10 min-w-40 rounded-lg border border-ink-200 bg-white px-3 text-sm font-medium text-ink-900 shadow-soft focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
        >
          {DATE_PRESETS.map((p) => (
            <option key={p} value={p}>
              {DATE_PRESET_LABELS[p]}
            </option>
          ))}
        </select>
      </label>
      {custom && (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (cFrom) go({ range: "custom", from: cFrom, to: cTo || cFrom });
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">From</span>
            <input type="date" value={cFrom} onChange={(e) => setCFrom(e.target.value)} className="h-10 rounded-lg border border-ink-200 px-2 text-sm" required />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">To</span>
            <input type="date" value={cTo} onChange={(e) => setCTo(e.target.value)} className="h-10 rounded-lg border border-ink-200 px-2 text-sm" />
          </label>
          <button type="submit" className="h-10 rounded-lg bg-ink-900 px-3 text-sm font-medium text-white">
            Apply
          </button>
        </form>
      )}
    </div>
  );
}

type SyncState = { id: string; status: string; progress?: string; imported?: number; updated?: number; skipped?: number; failed?: number; errors?: string[] };

/** Refresh (re-read the database), Sync (fetch from the registry now), auto-refresh and export. */
export function SyncControls({
  country,
  canSync,
  canExport,
  exportHref,
  realTime,
  lastFetchedAt,
  syncDay,
  isToday,
  runningSyncId,
  disabledReason,
}: {
  country: string;
  canSync: boolean;
  canExport: boolean;
  exportHref: string;
  realTime: boolean;
  lastFetchedAt?: string | null;
  /** Single selected day to sync (defaults to today). */
  syncDay?: string;
  isToday: boolean;
  runningSyncId?: string | null;
  disabledReason?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [sync, setSync] = useState<SyncState | null>(runningSyncId ? { id: runningSyncId, status: "RUNNING" } : null);
  const [auto, setAuto] = useState<number>(0);
  const [, tick] = useState(0);
  const autoKey = `et_autorefresh_${country}`;
  const pollRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(autoKey) ?? 0);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore a per-viewer preference after hydration
      if (realTime && v) setAuto(v);
    } catch {
      /* ignore */
    }
  }, [autoKey, realTime]);

  // Re-render every 15s so "last fetched … ago" stays truthful.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const poll = useRef<(id: string) => void>(() => undefined);
  useEffect(() => {
    poll.current = (id: string) => {
      clearTimeout(pollRef.current);
      pollRef.current = setTimeout(async () => {
        try {
          const s = await apiFetch<SyncState>(`/api/registry/sync/${id}`);
          setSync(s);
          if (s.status === "RUNNING") return poll.current(id);
          if (s.status === "FAILED") toast.error(s.errors?.[0] ?? "Sync failed — the registry may be unavailable.");
          else toast.success(`Sync ${s.status === "PARTIAL" ? "finished with warnings" : "complete"}: ${s.imported ?? 0} new, ${s.updated ?? 0} updated, ${s.skipped ?? 0} unchanged.`);
          router.refresh();
        } catch {
          poll.current(id);
        }
      }, 1500);
    };
  }, [router, toast]);

  useEffect(() => {
    if (runningSyncId) poll.current(runningSyncId);
    return () => clearTimeout(pollRef.current);
  }, [runningSyncId]);

  async function startSync() {
    try {
      const r = await apiFetch<{ syncId: string; alreadyRunning: boolean }>("/api/registry/sync", { body: isToday || !syncDay ? { country, kind: "TODAY" } : { country, kind: "DATE", date: syncDay } });
      setSync({ id: r.syncId, status: "RUNNING", progress: r.alreadyRunning ? "A sync is already running…" : "Starting…" });
      poll.current(r.syncId);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not start the sync");
    }
  }

  // Auto refresh: real-time providers only, default off.
  const startRef = useRef(startSync);
  useEffect(() => {
    startRef.current = startSync;
  });
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => {
      if (canSync && isToday) void startRef.current();
      else router.refresh();
    }, auto * 60_000);
    return () => clearInterval(t);
  }, [auto, canSync, isToday, router]);

  const running = sync?.status === "RUNNING";
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => router.refresh()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 text-sm font-medium text-ink-700 hover:bg-ink-50" title="Reload the list from the database">
          <RefreshCw className="h-4 w-4" aria-hidden /> Refresh
        </button>
        {canSync && (
          <button
            type="button"
            onClick={startSync}
            disabled={running || !!disabledReason}
            title={disabledReason ?? "Fetch the latest registrations from the registry now"}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-semibold text-white shadow-soft hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <CloudDownload className={cn("h-4 w-4", running && "animate-pulse")} aria-hidden />
            {running ? "Syncing…" : isToday || !syncDay ? "Sync today" : `Sync ${syncDay}`}
          </button>
        )}
        {canExport && (
          <a href={exportHref} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 text-sm font-medium text-ink-700 hover:bg-ink-50" download>
            <Download className="h-4 w-4" aria-hidden /> Export CSV
          </a>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-ink-500" aria-live="polite">
        {running ? <span className="font-medium text-brand-700">{sync?.progress ?? "Syncing…"}</span> : lastFetchedAt ? <span>Last fetched {formatRelative(lastFetchedAt)}</span> : <span>Not fetched yet</span>}
        {realTime && (
          <label className="inline-flex items-center gap-1">
            Auto refresh
            <select
              value={auto}
              onChange={(e) => {
                const v = Number(e.target.value);
                setAuto(v);
                try {
                  localStorage.setItem(autoKey, String(v));
                } catch {
                  /* ignore */
                }
              }}
              className="h-7 rounded-md border border-ink-200 bg-white px-1.5 text-xs"
            >
              <option value={0}>Off</option>
              <option value={5}>5 min</option>
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
            </select>
          </label>
        )}
      </div>
    </div>
  );
}

/** Search + filters for the company list. All filtering happens server-side via URL params. */
export function CompanyFilters({ industries, sorts }: { industries: { value: string; label: string }[]; sorts: { value: string; label: string }[] }) {
  const { go, search } = useParamsNav();
  const [q, setQ] = useState(search.get("q") ?? "");
  const [open, setOpen] = useState(() => ["industry", "industryCode", "minCompleteness", "relevance", "qualified", "minScore", "saved", "events", "research"].some((k) => search.get(k)));
  const contact = new Set((search.get("contact") ?? "").split(",").filter(Boolean));
  const activeCount = ["industry", "industryCode", "minCompleteness", "relevance", "qualified", "notContacted", "minScore", "q", "contact", "fit", "followUpDue", "eligibility", "events", "research"].filter((k) => search.get(k)).length;

  function toggleContact(f: string) {
    const next = new Set(contact);
    if (next.has(f)) next.delete(f);
    else {
      next.add(f);
      const exclusive: Record<string, string[]> = { nodirect: ["email", "phone", "both", "direct"], form: ["email", "phone", "both", "direct"], none: ["email", "phone", "both", "website", "person", "complete"] };
      for (const x of exclusive[f] ?? []) next.delete(x);
      for (const [k, v] of Object.entries(exclusive)) if (v.includes(f)) next.delete(k);
    }
    go({ contact: [...next].join(",") || null });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-60 flex-1"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            go({ q: q.trim() || null });
          }}
          role="search"
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, org. number, email, phone, website, address…" aria-label="Search companies" className="h-10 w-full rounded-lg border border-ink-200 bg-white pl-9 pr-3 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100" />
        </form>
        <label className="flex items-center gap-2 text-sm text-ink-600">
          <span className="sr-only sm:not-sr-only">Sort</span>
          <select value={search.get("sort") ?? "contact"} onChange={(e) => go({ sort: e.target.value === "contact" ? null : e.target.value })} className="h-10 rounded-lg border border-ink-200 bg-white px-2 text-sm">
            {sorts.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={cn("inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium", open ? "border-brand-300 bg-brand-50 text-brand-800" : "border-ink-200 bg-white text-ink-700 hover:bg-ink-50")}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden /> Filters {activeCount > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[11px] text-white">{activeCount}</span>}
        </button>
        {activeCount > 0 && (
          <button type="button" onClick={() => go({ q: null, contact: null, industry: null, industryCode: null, minCompleteness: null, relevance: null, qualified: null, notContacted: null, minScore: null, fit: null, followUpDue: null, eligibility: null, events: null, research: null })} className="inline-flex h-10 items-center gap-1 px-2 text-sm text-ink-500 hover:text-ink-800">
            <X className="h-4 w-4" aria-hidden /> Clear
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Contact availability">
        {PRIMARY_CONTACT_FILTERS.map((f) => (
          <button key={f} type="button" aria-pressed={contact.has(f)} onClick={() => toggleContact(f)} className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", contact.has(f) ? "border-brand-400 bg-brand-600 text-white" : "border-ink-200 bg-white text-ink-700 hover:border-ink-300")}>
            {CONTACT_FILTER_LABELS[f]}
          </button>
        ))}
        <span className="mx-1 w-px self-stretch bg-ink-200" aria-hidden />
        {(
          [
            ["fit", "Service fit", "yes"],
            ["notContacted", "Not contacted", "yes"],
            ["followUpDue", "Follow-up due", "yes"],
            ["eligibility", "Review cleared", "CLEARED"],
          ] as const
        ).map(([key, label, value]) => {
          const on = search.get(key) === value;
          return (
            <button key={key} type="button" aria-pressed={on} onClick={() => go({ [key]: on ? null : value })} className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", on ? "border-ink-700 bg-ink-800 text-white" : "border-ink-200 bg-white text-ink-700 hover:border-ink-300")}>
              {label}
            </button>
          );
        })}
      </div>

      {open && (
        <div className="grid gap-3 rounded-xl border border-ink-200 bg-ink-50/60 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-600">
            Industry
            <select value={search.get("industry") ?? ""} onChange={(e) => go({ industry: e.target.value || null })} className="h-9 rounded-lg border border-ink-200 bg-white px-2 text-sm font-normal text-ink-900">
              <option value="">All industries</option>
              {industries.map((i) => (
                <option key={i.value} value={i.value}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>
          <form
            className="flex flex-col gap-1 text-xs font-medium text-ink-600"
            onSubmit={(e) => {
              e.preventDefault();
              const v = new FormData(e.currentTarget).get("industryCode");
              go({ industryCode: typeof v === "string" && v.trim() ? v.trim() : null });
            }}
          >
            <label htmlFor="industryCode">Industry code starts with</label>
            <input id="industryCode" name="industryCode" defaultValue={search.get("industryCode") ?? ""} placeholder="e.g. 62 or 62.01" className="h-9 rounded-lg border border-ink-200 bg-white px-2 text-sm font-normal text-ink-900" />
          </form>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-600">
            Contact completeness
            <select value={search.get("minCompleteness") ?? ""} onChange={(e) => go({ minCompleteness: e.target.value || null })} className="h-9 rounded-lg border border-ink-200 bg-white px-2 text-sm font-normal text-ink-900">
              <option value="">Any</option>
              <option value="30">At least 30%</option>
              <option value="55">At least 55%</option>
              <option value="75">At least 75%</option>
              <option value="100">100%</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-600">
            Lead score
            <select value={search.get("minScore") ?? ""} onChange={(e) => go({ minScore: e.target.value || null })} className="h-9 rounded-lg border border-ink-200 bg-white px-2 text-sm font-normal text-ink-900">
              <option value="">Any</option>
              <option value="40">40+</option>
              <option value="60">60+</option>
              <option value="80">80+</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-600">
            Qualification
            <select value={search.get("relevance") ?? ""} onChange={(e) => go({ relevance: e.target.value || null })} className="h-9 rounded-lg border border-ink-200 bg-white px-2 text-sm font-normal text-ink-900">
              <option value="">Any</option>
              <option value="UNREVIEWED">Not reviewed yet</option>
              {RELEVANCE_VALUES.map((r) => (
                <option key={r} value={r}>
                  {RELEVANCE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink-700">
            <input type="checkbox" checked={search.get("qualified") === "yes"} onChange={(e) => go({ qualified: e.target.checked ? "yes" : null })} className="h-4 w-4 rounded border-ink-300" />
            Qualified leads only
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-600">
            Event type
            <select value={search.get("events") ?? "new"} onChange={(e) => go({ events: e.target.value === "new" ? null : e.target.value })} className="h-9 rounded-lg border border-ink-200 bg-white px-2 text-sm font-normal text-ink-900">
              <option value="new">New legal entities only</option>
              <option value="review">Other events (branches, continuations, ambiguous)</option>
              <option value="all">All events</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-600">
            Research status
            <select value={search.get("research") ?? ""} onChange={(e) => go({ research: e.target.value || null })} className="h-9 rounded-lg border border-ink-200 bg-white px-2 text-sm font-normal text-ink-900">
              <option value="">Any</option>
              {Object.entries(RESEARCH_STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
