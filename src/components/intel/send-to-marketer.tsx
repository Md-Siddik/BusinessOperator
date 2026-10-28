"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Send } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlay";
import { LoadingState } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

type TableState = { assignment?: { id: string; status: string; sentAt: string }; viewers: number };
type SendResult = { status: "sent" | "resent" | "already"; assignmentId: string; viewers: number };

const viewersText = (n: number) => (n === 0 ? "No Digital Marketer can open the table yet." : `${n} Digital Marketer${n === 1 ? "" : "s"} can see it.`);

/**
 * "Send to Marketer" in the Lead column of Today's New Companies (Owner only). One click adds the
 * company to the shared Digital Marketer table — there is no recipient to choose; every marketer
 * with "View Marketer Table" sees it. Clicking a company that is already in the table offers to
 * remove it. Sending is idempotent server-side — a repeated click never creates a second row.
 */
export function SendToMarketerButton({ companyId, companyName, sentCount = 0, disabled, size = "sm", onChange }: { companyId: string; companyName: string; sentCount?: number; disabled?: boolean; size?: "sm" | "md"; onChange?: (sentCount: number) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<TableState | null>(null);
  const sent = sentCount > 0;

  async function send(e: React.MouseEvent) {
    e.stopPropagation();
    if (busy) return;
    if (sent) {
      setOpen(true);
      setState(null);
      apiFetch<TableState>(`/api/lead-assignments?companyId=${encodeURIComponent(companyId)}`)
        .then(setState)
        .catch((err) => {
          toast.error(err instanceof ApiError ? err.message : "Could not load the marketer table.");
          setOpen(false);
        });
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<SendResult>("/api/lead-assignments", { body: { companyId } });
      if (res.status === "already") toast.info(`${companyName} is already in the marketer table.`);
      else toast.success(`${companyName} added to the marketer table. ${viewersText(res.viewers)}`);
      onChange?.(1);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not send the lead.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!state?.assignment || busy) return;
    setBusy(true);
    try {
      await apiFetch(`/api/lead-assignments/${state.assignment.id}`, { method: "DELETE" });
      toast.success(`${companyName} removed from the marketer table.`);
      onChange?.(0);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not remove the lead.");
    } finally {
      setBusy(false);
    }
  }

  const btn = size === "sm" ? "h-7 rounded-md px-2 text-[11px]" : "h-8 rounded-lg px-2.5 text-xs";

  return (
    <>
      <button
        type="button"
        onClick={send}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        title={disabled ? "Demo companies can't be sent" : sent ? "In the Digital Marketer table — click to remove" : "Add this lead to the Digital Marketer table"}
        className={cn(
          "inline-flex items-center gap-1 border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50",
          btn,
          sent ? "border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100" : "border-ink-200 bg-white text-ink-600 hover:border-ink-300 hover:text-ink-900",
        )}
      >
        {sent ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
        <span>{busy ? "Sending…" : sent ? "Sent" : "Send to Marketer"}</span>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="In the marketer table" description={companyName} size="sm">
        {!state ? (
          <LoadingState label="Loading…" />
        ) : (
          <div className="space-y-4 text-sm text-ink-700">
            <p>
              {state.assignment?.status === "ACTIVE" ? `Added ${formatDateTime(state.assignment.sentAt)}. ` : "Not currently in the table. "}
              {viewersText(state.viewers)}{" "}
              <Link href="/dashboard/marketer-leads" className="font-medium text-brand-700 underline">
                Open the table
              </Link>
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Close
              </Button>
              {state.assignment?.status === "ACTIVE" && (
                <Button variant="outline" size="sm" onClick={() => void remove()} loading={busy}>
                  Remove from table
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
