"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { AlertTriangle, CheckCircle2, EyeOff, Send, UserRound } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlay";
import { LoadingState } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type Recipient = { id: string; name: string; email: string; canView: boolean; assignment?: { id: string; status: string; sentAt: string } };
type SendResult = { status: "sent" | "resent" | "already"; recipient: { id: string; name: string }; visible: boolean };

const HIDDEN_NOTE = "They won't see it until you grant “View Assigned Client Leads”.";

/**
 * "Send to Marketer" in the Lead column of Today's New Companies (Owner only). Opens a compact
 * picker of Digital Marketers; with a single marketer it asks for a plain confirmation instead.
 * Sending is idempotent server-side — a repeated click never creates a second assignment.
 */
export function SendToMarketerButton({ companyId, companyName, sentCount = 0, disabled, size = "sm", onChange }: { companyId: string; companyName: string; sentCount?: number; disabled?: boolean; size?: "sm" | "md"; onChange?: (sentCount: number) => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [recipients, setRecipients] = useState<Recipient[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    setRecipients(null);
    try {
      const res = await apiFetch<{ recipients: Recipient[] }>(`/api/lead-assignments?companyId=${encodeURIComponent(companyId)}`);
      setRecipients(res.recipients);
      const available = res.recipients.filter((r) => r.assignment?.status !== "ACTIVE");
      setSelected(available.length === 1 ? available[0]!.id : null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Could not load marketers.");
    }
  }, [companyId]);

  function openPicker(e: React.MouseEvent) {
    e.stopPropagation();
    setOpen(true);
    void load();
  }

  const activeCount = (list: Recipient[]) => list.filter((r) => r.assignment?.status === "ACTIVE").length;

  async function send() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const res = await apiFetch<SendResult>("/api/lead-assignments", { body: { companyId, recipientId: selected } });
      const who = res.recipient.name;
      if (res.status === "already") toast.info(`${companyName} was already sent to ${who}.`);
      else toast.success(`${companyName} sent to ${who}.${res.visible ? "" : ` ${HIDDEN_NOTE}`}`);
      const next = (recipients ?? []).map((r) => (r.id === res.recipient.id ? { ...r, assignment: { id: r.assignment?.id ?? "", status: "ACTIVE", sentAt: new Date().toISOString() } } : r));
      setRecipients(next);
      onChange?.(activeCount(next));
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not send the lead.");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(r: Recipient) {
    if (!r.assignment || busy) return;
    setBusy(true);
    try {
      await apiFetch(`/api/lead-assignments/${r.assignment.id}`, { method: "DELETE" });
      const next = (recipients ?? []).map((x) => (x.id === r.id ? { ...x, assignment: x.assignment && { ...x.assignment, status: "WITHDRAWN" } } : x));
      setRecipients(next);
      onChange?.(activeCount(next));
      toast.success(`Withdrawn from ${r.name}.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not withdraw the lead.");
    } finally {
      setBusy(false);
    }
  }

  const btn = size === "sm" ? "h-7 rounded-md px-2 text-[11px]" : "h-8 rounded-lg px-2.5 text-xs";
  const available = (recipients ?? []).filter((r) => r.assignment?.status !== "ACTIVE");
  const single = recipients && recipients.length === 1 ? recipients[0]! : null;
  const chosen = recipients?.find((r) => r.id === selected);

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled}
        title={disabled ? "Demo companies can't be sent" : sentCount ? `Sent to ${sentCount} marketer${sentCount === 1 ? "" : "s"} — send to another or withdraw` : "Send this lead to a Digital Marketer"}
        className={cn(
          "inline-flex items-center gap-1 border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50",
          btn,
          sentCount ? "border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100" : "border-ink-200 bg-white text-ink-600 hover:border-ink-300 hover:text-ink-900",
        )}
      >
        {sentCount ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
        <span>{sentCount ? `Sent${sentCount > 1 ? ` ·${sentCount}` : ""}` : "Send to Marketer"}</span>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Send to Marketer" description={companyName} size="sm">
        {loadError ? (
          <div className="space-y-3" role="alert">
            <p className="text-sm text-red-700">{loadError}</p>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : !recipients ? (
          <LoadingState label="Loading marketers…" />
        ) : recipients.length === 0 ? (
          <div className="space-y-2 text-sm text-ink-600">
            <p>There are no active Digital Marketer accounts yet.</p>
            <Link href="/dashboard/users" className="font-medium text-brand-700 underline">
              Create one in Users &amp; access
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {single ? (
              <SingleRecipient r={single} />
            ) : (
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-ink-800">Choose a marketer</legend>
                <ul className="max-h-72 space-y-1.5 overflow-y-auto">
                  {recipients.map((r) => {
                    const active = r.assignment?.status === "ACTIVE";
                    return (
                      <li key={r.id}>
                        <label className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm", selected === r.id ? "border-brand-400 bg-brand-50" : "border-ink-200 hover:bg-ink-50", active && "cursor-default opacity-90")}>
                          <input type="radio" name="recipient" value={r.id} checked={selected === r.id} disabled={active} onChange={() => setSelected(r.id)} className="h-4 w-4 border-ink-300 text-brand-600" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-ink-900">{r.name}</span>
                            <span className="block truncate text-xs text-ink-500">{r.email}</span>
                          </span>
                          <RecipientBadges r={r} />
                        </label>
                        {active && (
                          <button type="button" onClick={() => void withdraw(r)} disabled={busy} className="mt-1 text-xs font-medium text-ink-500 underline hover:text-red-700">
                            Withdraw from {r.name}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            )}
            {single?.assignment?.status === "ACTIVE" && (
              <button type="button" onClick={() => void withdraw(single)} disabled={busy} className="text-xs font-medium text-ink-500 underline hover:text-red-700">
                Withdraw from {single.name}
              </button>
            )}
            {chosen && !chosen.canView && (
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  {chosen.name} can&apos;t see client leads yet. The lead is kept securely; {HIDDEN_NOTE.charAt(0).toLowerCase() + HIDDEN_NOTE.slice(1)}{" "}
                  <Link href="/dashboard/users" className="font-medium underline">
                    Manage access
                  </Link>
                </span>
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void send()} loading={busy} disabled={!selected || available.length === 0}>
                <Send className="h-4 w-4" aria-hidden />
                {chosen ? `Send to ${chosen.name.split(" ")[0]}` : "Send lead"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function RecipientBadges({ r }: { r: Recipient }) {
  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      {r.assignment?.status === "ACTIVE" && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800">Already sent</span>}
      {!r.canView && (
        <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900" title="No “View Assigned Client Leads” permission yet">
          <EyeOff className="h-3 w-3" aria-hidden /> No access yet
        </span>
      )}
    </span>
  );
}

function SingleRecipient({ r }: { r: Recipient }) {
  const active = r.assignment?.status === "ACTIVE";
  return (
    <div className="flex items-center gap-3 rounded-lg border border-ink-200 px-3 py-2.5">
      <UserRound className="h-5 w-5 text-ink-400" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium text-ink-900">{active ? `Already sent to ${r.name}` : `Send to ${r.name}?`}</p>
        <p className="truncate text-xs text-ink-500">{r.email} · the only Digital Marketer</p>
      </div>
      <RecipientBadges r={r} />
    </div>
  );
}
