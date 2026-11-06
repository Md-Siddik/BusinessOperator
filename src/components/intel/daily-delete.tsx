"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DailyScope } from "@/features/daily-records/deletion";
import { apiFetch } from "@/lib/api/client";
import { Modal } from "@/components/ui/overlay";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function DailyDelete({ scope, backupConfigured = false }: { scope: DailyScope; backupConfigured?: boolean }) {
  const [ticket, setTicket] = useState<{ token: string; count: number; stage: number } | null>(null);
  const [checked, setChecked] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const toast = useToast();
  const router = useRouter();
  const label = scope.category === "company" ? "Company Intelligence" : "Job Intelligence";
  async function submit() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      if (!ticket) {
        const prepared = await apiFetch<{ token: string; count: number; stage: number }>("/api/daily-records/deletion", { body: scope });
        setChecked(false); setTyped(""); setTicket(prepared);
      } else {
        const result = await apiFetch<{ stage: number; deleted?: number }>("/api/daily-records/deletion", { method: "PATCH", body: {
          token: ticket.token, action: ticket.stage === 1 ? "continue" : ticket.stage === 2 ? "acknowledge" : "delete",
          ...(ticket.stage === 2 && { acknowledged: checked }), ...(ticket.stage === 3 && { confirmation: typed }),
        } });
        if (result.stage === 4) {
          toast.success(`${result.deleted} records permanently deleted.`);
          setTicket(null); router.refresh();
        } else setTicket({ ...ticket, stage: result.stage });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Deletion failed. Restart confirmation.");
      setTicket(null);
    } finally { locked.current = false; setBusy(false); }
  }
  return <>
    <Button variant="outline" size="sm" onClick={submit} disabled={busy || !backupConfigured} title={!backupConfigured ? "Daily deletion requires a configured private backup location." : undefined}>Delete This Day&apos;s Records</Button>
    <Modal open={!!ticket} onClose={() => setTicket(null)} dismissible={!busy} title={`Delete daily records — Step ${ticket?.stage ?? 1} of 3`} footer={<>
      <Button variant="outline" disabled={busy} onClick={() => setTicket(null)}>Cancel</Button>
      <Button disabled={busy || (ticket?.stage === 2 && !checked) || (ticket?.stage === 3 && typed !== `DELETE ${scope.day}`)} onClick={submit}>
        {busy ? "Processing…" : ticket?.stage === 1 ? "Continue" : ticket?.stage === 2 ? "Proceed to Final Confirmation" : "Permanently Delete Records"}
      </Button>
    </>}>
      <div className="space-y-4 text-sm">
        <p><strong>{label}</strong> · {scope.day} · <strong>{ticket?.count}</strong> matching records</p>
        <p>Scope: {scope.filters.country || "All countries"}; current list filters and date basis apply.</p>
        <p className="text-red-700">These records will be permanently removed. Other dates, categories and user accounts are excluded.</p>
        <p>A full server backup has been written and verified. You can also use the existing export button before continuing.</p>
        {ticket?.stage === 2 && <label className="flex items-start gap-2"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />I understand that these records will be permanently deleted and cannot be recovered without a backup.</label>}
        {ticket?.stage === 3 && <label className="block space-y-2"><span>Type <strong>DELETE {scope.day}</strong> to confirm.</span><input autoComplete="off" value={typed} onChange={e => setTyped(e.target.value)} className="block w-full rounded-lg border border-ink-200 px-3 py-2" /></label>}
      </div>
    </Modal>
  </>;
}
