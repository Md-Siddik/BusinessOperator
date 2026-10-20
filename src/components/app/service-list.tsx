"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, Eye, Pencil, RotateCcw, Star, Trash2 } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { EN_PRICE_LABELS, priceDisplay, type ServiceDiscount, type ServicePricing } from "@/lib/service-pricing";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";

export type ServiceRow = {
  id: string;
  slug: string;
  name: string;
  category?: string;
  active: boolean;
  featured: boolean;
  displayOrder: number;
  deleted: boolean;
  pricing: ServicePricing & { note?: string };
  discount: ServiceDiscount | null;
  engagementOptions: string[];
  translations: string[];
  updatedAt: string;
};

const ENGAGEMENT_LABEL: Record<string, string> = { monthly: "Monthly", project: "Task-based", growth: "Growth partnership" };
const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Service list with quick actions. Every action goes through the API (re-checked on the server). */
export function ServiceList({ rows, base, trash, canDeletePermanently }: { rows: ServiceRow[]; base: string; trash: boolean; canDeletePermanently: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ServiceRow | null>(null);

  async function act(id: string, fn: () => Promise<unknown>, done: string) {
    setBusy(id);
    try {
      await fn();
      toast.success(done);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  function move(index: number, dir: -1 | 1) {
    const ids = rows.map((r) => r.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    void act(rows[index]!.id, () => apiFetch("/api/services/reorder", { body: { ids } }), "Order updated");
  }

  if (!rows.length) {
    return <p className="px-5 py-10 text-center text-sm text-ink-500">{trash ? "The trash is empty." : "No services yet. Add your first service to publish it on the website."}</p>;
  }

  return (
    <>
      <ul className="divide-y divide-ink-100">
        {rows.map((r, i) => {
          const price = priceDisplay(r.pricing, r.discount, EN_PRICE_LABELS, "en");
          return (
            <li key={r.id} className={cn("flex flex-col gap-3 px-4 py-4 sm:px-5 lg:flex-row lg:items-center", busy === r.id && "opacity-60")}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`${base}/service-management/${r.id}`} className="font-semibold text-ink-900 hover:text-brand-700">
                    {r.name}
                  </Link>
                  {r.deleted ? <Badge tone="danger">In trash</Badge> : r.active ? <Badge tone="success" dot>Active</Badge> : <Badge tone="warning">Inactive</Badge>}
                  {r.featured && !r.deleted && (
                    <Badge tone="info">
                      <Star className="mr-1 inline h-3 w-3" aria-hidden />
                      Featured
                    </Badge>
                  )}
                  {r.translations.map((l) => (
                    <span key={l} className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-ink-600" title="Translation available">
                      {l}
                    </span>
                  ))}
                </div>
                <p className="mt-0.5 truncate text-xs text-ink-500">
                  /services/{r.slug}
                  {r.category ? ` · ${r.category}` : ""}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4 lg:w-[34rem] lg:shrink-0">
                <div className="min-w-0">
                  <dt className="text-ink-400">Price</dt>
                  <dd className="truncate font-medium text-ink-800" title={price.text}>
                    {price.hasPrice ? price.text : <span className="font-normal text-ink-500">No amount ({r.pricing.model})</span>}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-ink-400">Discount</dt>
                  <dd className="truncate text-ink-800" title={price.discountLabel}>
                    {price.discountLabel ?? (r.discount?.enabled ? <span className="text-amber-700">Not running</span> : "—")}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-ink-400">Engagement</dt>
                  <dd className="truncate text-ink-800">{r.engagementOptions.map((e) => ENGAGEMENT_LABEL[e] ?? e).join(", ") || "—"}</dd>
                </div>
                <div>
                  <dt className="text-ink-400">Updated</dt>
                  <dd className="text-ink-800">{fmt(r.updatedAt)}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap items-center gap-1.5 lg:shrink-0">
                {r.deleted ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => act(r.id, () => apiFetch(`/api/services/${r.id}/restore`, { body: {} }), "Restored (inactive)")}>
                      <RotateCcw className="h-4 w-4" aria-hidden /> Restore
                    </Button>
                    {canDeletePermanently && (
                      <Button size="sm" variant="ghost" className="text-red-700 hover:bg-red-50" onClick={() => setDeleting(r)}>
                        <Trash2 className="h-4 w-4" aria-hidden /> Delete permanently
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    <Link href={`${base}/service-management/${r.id}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-ink-200 px-2.5 text-xs font-medium text-ink-700 hover:border-brand-300 hover:text-brand-700">
                      <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
                    </Link>
                    <a href={`/services/${r.slug}/preview`} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1 rounded-lg border border-ink-200 px-2.5 text-xs font-medium text-ink-700 hover:border-brand-300 hover:text-brand-700">
                      <Eye className="h-3.5 w-3.5" aria-hidden /> Preview
                    </a>
                    <button
                      type="button"
                      onClick={() => act(r.id, () => apiFetch(`/api/services/${r.id}/status`, { body: { active: !r.active } }), r.active ? "Deactivated — hidden from the website" : "Published on the website")}
                      className={cn("inline-flex h-8 items-center rounded-lg border px-2.5 text-xs font-medium", r.active ? "border-ink-200 text-ink-700 hover:bg-ink-50" : "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100")}
                    >
                      {r.active ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      type="button"
                      disabled={!r.active && !r.featured}
                      title={!r.active ? "Activate the service to feature it" : undefined}
                      onClick={() => act(r.id, () => apiFetch(`/api/services/${r.id}`, { method: "PATCH", body: { featured: !r.featured } }), r.featured ? "Removed from the homepage" : "Featured on the homepage")}
                      aria-pressed={r.featured}
                      className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg border disabled:opacity-40", r.featured ? "border-brand-300 bg-brand-50 text-brand-700" : "border-ink-200 text-ink-500 hover:text-brand-700")}
                      aria-label={r.featured ? `Unfeature ${r.name}` : `Feature ${r.name} on the homepage`}
                    >
                      <Star className="h-4 w-4" aria-hidden />
                    </button>
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-ink-200 text-ink-500 hover:text-ink-900 disabled:opacity-30" aria-label={`Move ${r.name} up`}>
                      <ArrowUp className="h-4 w-4" aria-hidden />
                    </button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-ink-200 text-ink-500 hover:text-ink-900 disabled:opacity-30" aria-label={`Move ${r.name} down`}>
                      <ArrowDown className="h-4 w-4" aria-hidden />
                    </button>
                    <button type="button" onClick={() => setDeleting(r)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-ink-200 text-ink-500 hover:border-red-200 hover:text-red-700" aria-label={`Delete ${r.name}`}>
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {deleting && <DeleteDialog row={deleting} canDeletePermanently={canDeletePermanently} onClose={() => setDeleting(null)} onDone={() => router.refresh()} />}
    </>
  );
}

/**
 * Removal is deliberate: "Move to trash" (hidden, restorable) is the normal choice.
 * Permanent deletion is the Owner's, needs the address typed, and is refused by the server
 * while enquiries reference the service.
 */
function DeleteDialog({ row, canDeletePermanently, onClose, onDone }: { row: ServiceRow; canDeletePermanently: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState<"trash" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "trash" | "delete") {
    setPending(kind);
    setError(null);
    try {
      if (kind === "trash") await apiFetch(`/api/services/${row.id}`, { method: "DELETE" });
      else await apiFetch(`/api/services/${row.id}?permanent=1`, { method: "DELETE", body: { confirmSlug: confirm } });
      toast.success(kind === "trash" ? "Moved to the trash — hidden from the website" : "Service deleted permanently");
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setPending(null);
    }
  }

  return (
    <Modal
      open
      onClose={() => !pending && onClose()}
      title={row.deleted ? `Delete “${row.name}” permanently?` : `Remove “${row.name}”?`}
      description={row.deleted ? "This cannot be undone." : "Moving to the trash hides the service and its landing page, and keeps everything so it can be restored."}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={!!pending}>
            Cancel
          </Button>
          {!row.deleted && (
            <Button onClick={() => run("trash")} loading={pending === "trash"}>
              <Trash2 className="h-4 w-4" aria-hidden /> Move to trash
            </Button>
          )}
        </>
      }
    >
      {row.active && !row.deleted && <p className="mb-3 text-sm text-ink-600">Tip: if the service might return, choose “Deactivate” instead — it stays in the list.</p>}
      {canDeletePermanently && (
        <div className="space-y-2 rounded-xl border border-red-200 bg-red-50/60 p-3">
          <p className="text-sm font-medium text-red-900">Delete permanently (Owner only)</p>
          <p className="text-xs text-red-800">
            Type <span className="font-mono font-semibold">{row.slug}</span> to confirm. Services that enquiries refer to cannot be deleted — keep them deactivated so the history stays intact.
          </p>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={row.slug} aria-label="Type the service address to confirm" autoComplete="off" />
          <Button size="sm" variant="outline" className="border-red-300 text-red-800 hover:bg-red-100" disabled={confirm.trim() !== row.slug} loading={pending === "delete"} onClick={() => run("delete")}>
            Delete permanently
          </Button>
        </div>
      )}
      {error && (
        <Alert tone="danger" title="Not deleted" className="mt-3">
          {error}
        </Alert>
      )}
    </Modal>
  );
}
