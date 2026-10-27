"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bookmark, BookmarkCheck, ExternalLink, Layers, Link2, MessageSquareText } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { CONTACT_ROUTE_LABELS, REVIEW_STATUS_LABELS, REVIEW_STATUSES, SERVICE_CATEGORY_LABELS, type ContactRoute, type ServiceCategory } from "@/features/opportunities/constants";
import { formatInZone, zoneFor } from "@/features/opportunities/format";
import { ActivityBadge, CountryTag, SourceClassBadge, VerificationBadges } from "./badges";

export type OpportunityRow = {
  _id: string;
  type: "HIRING" | "PROCUREMENT";
  title?: string | null;
  organization?: { name?: string | null; registrationNumber?: string | null } | null;
  countryCode?: string | null;
  location?: string | null;
  sourceUrl?: string | null;
  applyUrl?: string | null;
  sourceClass: string;
  sourcePublisher?: string | null;
  publishedAt?: string | null;
  firstSeenAt: string;
  lastSeenAt?: string | null;
  deadline?: string | null;
  deadlineText?: string | null;
  activity: string;
  labels: string[];
  contactRoutes: string[];
  serviceCategories: string[];
  jobCategory?: string | null;
  noticeKind?: string | null;
  saved?: boolean;
  reviewStatus?: string;
  companyLink?: { companyId?: string; method?: string } | null;
  duplicateCount: number;
  lastNoteAt?: string | null;
};

/**
 * Opportunity results with bulk save / review actions. Every timestamp names what it is.
 * `readOnly` (delegated viewers): no selection, saving or review — and links go to `detailBase`.
 */
export function OpportunityTable({ rows, readOnly, detailBase = "/dashboard/opportunities" }: { rows: OpportunityRow[]; readOnly?: boolean; detailBase?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const allSelected = rows.length > 0 && selected.size === rows.length;

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function bulk(action: "save" | "unsave" | "review", reviewStatus?: string) {
    setBusy(action);
    try {
      const r = await apiFetch<{ updated: number }>("/api/opportunities/bulk", { body: { ids: [...selected], action, reviewStatus } });
      toast.success(`${r.updated} updated`);
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Bulk update failed");
    } finally {
      setBusy(null);
    }
  }

  async function toggleSaved(row: OpportunityRow) {
    setBusy(row._id);
    try {
      await apiFetch(`/api/opportunities/${row._id}`, { method: "PATCH", body: { saved: !row.saved } });
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not update");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {!readOnly && (
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-4 py-2.5" role="toolbar" aria-label="Bulk actions">
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r._id)))} aria-label="Select all on this page" />
          {selected.size ? `${selected.size} selected` : "Select"}
        </label>
        {selected.size > 0 && (
          <>
            <Button size="xs" variant="outline" loading={busy === "save"} onClick={() => bulk("save")}>
              Save
            </Button>
            <Button size="xs" variant="outline" loading={busy === "unsave"} onClick={() => bulk("unsave")}>
              Unsave
            </Button>
            <label className="sr-only" htmlFor="bulk-review">
              Set review status
            </label>
            <select id="bulk-review" className="h-7 rounded-lg border border-ink-200 bg-white px-2 text-xs" defaultValue="" onChange={(e) => e.target.value && bulk("review", e.target.value)} disabled={busy !== null}>
              <option value="">Set review status…</option>
              {REVIEW_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {REVIEW_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      )}
      <ul className="divide-y divide-ink-100">
        {rows.map((r) => {
          const tz = zoneFor(r.countryCode);
          const direct = r.contactRoutes.includes("DIRECT_APPLICATION") || r.contactRoutes.includes("PROCUREMENT_SUBMISSION");
          return (
            <li key={r._id} className="flex gap-3 px-4 py-3.5 hover:bg-ink-50/50">
              {!readOnly && <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-brand-600" checked={selected.has(r._id)} onChange={() => toggle(r._id)} aria-label={`Select ${r.title ?? "opportunity"}`} />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                  <div className="min-w-0">
                    <Link href={`${detailBase}/${r._id}`} className="text-sm font-semibold text-ink-900 hover:text-brand-700 hover:underline">
                      {r.title || "(untitled)"}
                    </Link>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-ink-600">
                      <span className="font-medium text-ink-800">{r.organization?.name ?? "Organization not published"}</span>
                      {r.companyLink?.companyId && (
                        <span className="inline-flex items-center gap-0.5 text-xs text-brand-700" title={`Linked to Company Intelligence (${r.companyLink.method?.replace(/_/g, " ").toLowerCase()})`}>
                          <Link2 className="h-3 w-3" aria-hidden /> company record
                        </span>
                      )}
                      <CountryTag code={r.countryCode} />
                      {r.location && <span className="text-xs text-ink-500">{r.location}</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <ActivityBadge activity={r.activity} />
                    {!readOnly && <button type="button" onClick={() => toggleSaved(r)} disabled={busy === r._id} className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900" aria-label={r.saved ? "Remove from saved" : "Save"} aria-pressed={!!r.saved}>
                      {r.saved ? <BookmarkCheck className="h-4 w-4 text-brand-600" aria-hidden /> : <Bookmark className="h-4 w-4" aria-hidden />}
                    </button>}
                  </div>
                </div>

                <VerificationBadges labels={r.labels} compact className="mt-2" />

                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-ink-400">Published (source)</dt>
                    <dd className="text-ink-700">{r.publishedAt ? formatInZone(r.publishedAt, tz, false) : "Not given by source"}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-400">First discovered</dt>
                    <dd className="text-ink-700">{formatInZone(r.firstSeenAt, tz, false)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-400">Last confirmed at source</dt>
                    <dd className="text-ink-700">{r.lastSeenAt ? formatInZone(r.lastSeenAt, tz) : "Never"}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-400">Deadline</dt>
                    <dd className="text-ink-700">{r.deadline ? formatInZone(r.deadline, tz) : r.deadlineText ? `“${r.deadlineText}” (as published)` : "Not published"}</dd>
                  </div>
                </dl>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                  <SourceClassBadge sourceClass={r.sourceClass} />
                  <span>{r.sourcePublisher}</span>
                  {r.duplicateCount > 0 && (
                    <span className="inline-flex items-center gap-1" title="Additional source records folded into this opportunity">
                      <Layers className="h-3 w-3" aria-hidden /> +{r.duplicateCount} source{r.duplicateCount === 1 ? "" : "s"}
                    </span>
                  )}
                  {r.lastNoteAt && (
                    <span className="inline-flex items-center gap-1">
                      <MessageSquareText className="h-3 w-3" aria-hidden /> notes
                    </span>
                  )}
                  {(r.jobCategory || r.noticeKind) && <span>{r.jobCategory ?? r.noticeKind}</span>}
                  {r.serviceCategories.slice(0, 3).map((c) => (
                    <span key={c} className="rounded bg-ink-100 px-1.5 py-0.5 text-ink-600">
                      {SERVICE_CATEGORY_LABELS[c as ServiceCategory] ?? c}
                    </span>
                  ))}
                  <span className={direct ? "text-emerald-700" : ""}>{CONTACT_ROUTE_LABELS[(r.contactRoutes[0] ?? "NONE") as ContactRoute]}</span>
                  {r.sourceUrl && (
                    <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                      Original source <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
