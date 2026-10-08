"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Download, Plus, Trash2 } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

type Item = { description: string; quantity: number; unitPrice: number | null; unit: string };
type State = { title: string; currency: string; items: Item[]; deliverables: string[]; timeline: string; terms: string; notes: string; status: string; recipientContactId: string; validUntil: string };

export function QuotationEditor({ id, initial, recipients, eligible }: { id: string; initial: State; recipients: { id: string; label: string }[]; eligible: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [s, setS] = useState<State>(initial);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof State>(k: K, v: State[K]) => setS((x) => ({ ...x, [k]: v }));
  const total = s.items.reduce((a, i) => a + (i.unitPrice ?? 0) * i.quantity, 0);
  const unpriced = s.items.filter((i) => i.unitPrice === null).length;

  async function save(status?: string) {
    setSaving(true);
    try {
      await apiFetch(`/api/quotations/${id}`, {
        method: "PATCH",
        body: {
          title: s.title,
          currency: s.currency,
          items: s.items.map((i) => ({ ...i, unit: i.unit || undefined })),
          deliverables: s.deliverables.filter(Boolean),
          timeline: s.timeline,
          terms: s.terms,
          notes: s.notes,
          recipientContactId: s.recipientContactId || null,
          ...(s.validUntil && { validUntil: s.validUntil }),
          ...(status && { status }),
        },
      });
      if (status) set("status", status);
      toast.success("Quotation saved");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5 rounded-2xl border border-ink-200 bg-white p-5">
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem_10rem]">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Title</span>
          <Input value={s.title} onChange={(e) => set("title", e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Currency</span>
          <Input value={s.currency} maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase())} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Valid until</span>
          <Input type="date" value={s.validUntil} onChange={(e) => set("validUntil", e.target.value)} />
        </label>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Recipient</span>
        <Select value={s.recipientContactId} onChange={(e) => set("recipientContactId", e.target.value)} disabled={!eligible}>
          <option value="">{eligible ? "No recipient selected" : "Clear outreach eligibility on the company first"}</option>
          {recipients.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </Select>
      </label>

      <div>
        <p className="mb-2 text-sm font-medium">Line items</p>
        <div className="space-y-2">
          {s.items.map((it, idx) => (
            <div key={idx} className="grid gap-2 sm:grid-cols-[1fr_5rem_6rem_8rem_auto]">
              <Input value={it.description} onChange={(e) => set("items", s.items.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))} aria-label="Description" />
              <Input type="number" min={0} value={it.quantity} onChange={(e) => set("items", s.items.map((x, i) => (i === idx ? { ...x, quantity: Number(e.target.value) } : x)))} aria-label="Quantity" />
              <Input value={it.unit} onChange={(e) => set("items", s.items.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x)))} placeholder="unit" aria-label="Unit" />
              <Input type="number" min={0} step="0.01" value={it.unitPrice ?? ""} placeholder="price — to confirm" onChange={(e) => set("items", s.items.map((x, i) => (i === idx ? { ...x, unitPrice: e.target.value === "" ? null : Number(e.target.value) } : x)))} aria-label="Unit price" />
              <button type="button" onClick={() => set("items", s.items.filter((_, i) => i !== idx))} className="rounded-lg p-2 text-ink-400 hover:bg-ink-50 hover:text-red-600" aria-label="Remove line">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Button size="xs" variant="ghost" onClick={() => set("items", [...s.items, { description: "", quantity: 1, unitPrice: null, unit: "" }])}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> Add line
          </Button>
        </div>
        <p className="mt-2 text-sm">
          Total: <strong className="tabular-nums">{new Intl.NumberFormat("en-GB", { style: "currency", currency: s.currency || "EUR" }).format(total)}</strong>
          {unpriced > 0 && <span className="ml-2 text-xs text-amber-700">{unpriced} line(s) without an approved price — shown as placeholders</span>}
        </p>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block font-medium">Deliverables (one per line)</span>
        <Textarea rows={4} value={s.deliverables.join("\n")} onChange={(e) => set("deliverables", e.target.value.split("\n"))} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Timeline</span>
          <Input value={s.timeline} onChange={(e) => set("timeline", e.target.value)} placeholder="[timeline to be confirmed]" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Status</span>
          <Select value={s.status} onChange={(e) => void save(e.target.value)}>
            <option value="DRAFT">Draft</option>
            <option value="READY">Ready</option>
            <option value="SHARED_MANUALLY">Shared manually</option>
            <option value="ACCEPTED">Accepted</option>
            <option value="DECLINED">Declined</option>
          </Select>
        </label>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Terms</span>
        <Textarea rows={4} value={s.terms} onChange={(e) => set("terms", e.target.value)} placeholder="[terms to be confirmed]" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Notes</span>
        <Textarea rows={2} value={s.notes} onChange={(e) => set("notes", e.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} loading={saving}>
          Save draft
        </Button>
        <a href={`/api/quotations/${id}/download`} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-ink-200 px-3 text-sm font-medium text-ink-700 hover:bg-ink-50">
          <Download className="h-4 w-4" aria-hidden /> Download (HTML → print to PDF)
        </a>
      </div>
    </div>
  );
}
