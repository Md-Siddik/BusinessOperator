"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Search, Send, Table2, UserRound, Users, X } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import styles from "./send-to-marketer.module.css";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

type TableState = { assignment?: { id: string; status: string; sentAt: string }; viewers: number };
type SendResult = { status: "sent" | "resent" | "already"; assignmentId: string; viewers: number };

const viewersText = (n: number) => (n === 0 ? "No Digital Marketer can open the table yet." : `${n} Digital Marketer${n === 1 ? "" : "s"} can see it.`);

/** Owner-confirmed shared or private delivery, with idempotent retries for single and bulk sends. */
export function SendToMarketerButton({ companyId, companyIds, companyName, sentCount = 0, disabled, size = "sm", onChange }: { companyId: string; companyIds?: string[]; companyName: string; sentCount?: number; disabled?: boolean; size?: "sm" | "md"; onChange?: (sentCount: number) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<TableState | null>(null);
  const [destinationType, setDestination] = useState("shared");
  const [recipientId, setRecipient] = useState("");
  const [query, setQuery] = useState("");
  const [marketers, setMarketers] = useState<{ id: string; name: string; email: string; role: string }[]>([]);
  const sent = sentCount > 0;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pickerTriggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const listId = useId();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [recipientPage, setRecipientPage] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(800);
  const pageSize = viewportHeight < 540 ? 1 : 3;
  const selected = marketers.find((m) => m.id === recipientId);
  const filtered = marketers.filter((m) => `${m.name} ${m.email} ${m.role === "ADMIN" ? "Admin" : "Marketer"}`.toLowerCase().includes(query.trim().toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(recipientPage, pageCount - 1);
  const visibleRecipients = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const count = companyIds?.length ?? 1;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    const resize = () => {
      const height = viewport?.height ?? window.innerHeight;
      setViewportHeight(height);
      if (dialogRef.current) {
        dialogRef.current.style.top = `${(viewport?.offsetTop ?? 0) + height / 2}px`;
      }
    };
    resize();
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    window.addEventListener("resize", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
      window.removeEventListener("resize", resize);
    };
  }, [open]);

  useEffect(() => {
    if (pickerOpen) searchRef.current?.focus();
  }, [pickerOpen]);

  function closePicker() {
    setPickerOpen(false);
    requestAnimationFrame(() => pickerTriggerRef.current?.focus());
  }


  async function send(e: React.MouseEvent) {
    e.stopPropagation();
    if (busy) return;
      setOpen(true);
      setState(null);
      setDestination("shared");
      setRecipient("");
      setQuery("");
      setPickerOpen(false);
      setRecipientPage(0);
      Promise.all([apiFetch<TableState>(`/api/lead-assignments?companyId=${encodeURIComponent(companyId)}`), apiFetch<typeof marketers>("/api/lead-assignments?eligible=true")])
        .then(([table, users]) => { setState(table); setMarketers(users); })
        .catch((err) => {
          toast.error(err instanceof ApiError ? err.message : "Could not load the marketer table.");
          setOpen(false);
        });
      return;
  }
  async function confirmSend() {
    setBusy(true);
    try {
      const res = await apiFetch<SendResult & { results?: (SendResult & { companyId: string; ok: boolean; error?: string })[] }>("/api/lead-assignments", { body: { ...(companyIds ? { companyIds } : { companyId }), destinationType, ...(destinationType === "individual" && { recipientId }) } });
      const destination = destinationType === "individual" ? marketers.find((m) => m.id === recipientId)?.name ?? "selected marketer" : "Marketer Table";
      if (res.results) {
        const failed = res.results.filter((r) => !r.ok);
        if (res.results.length > failed.length) toast.success(`${res.results.length - failed.length} records delivered to ${destination}.`);
        if (failed.length) {
          toast.error(`${failed.length} records failed: ${failed[0].error}. Retry safely; delivered records will not be duplicated.`);
          return;
        }
        if (destinationType === "shared") onChange?.(1);
        setOpen(false);
        return;
      }
      if (res.status === "already") toast.info(`${companyName}: this assignment already exists.`);
      else toast.success(`1 record delivered to ${destination}.`);
      if (destinationType === "shared") onChange?.(1);
      setOpen(false);
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
        title={disabled ? "Demo companies can't be sent" : "Choose the Marketer Table or an individual Digital Marketer"}
        className={cn(
          "inline-flex items-center gap-1 border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50",
          btn,
          sent ? "border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100" : "border-ink-200 bg-white text-ink-600 hover:border-ink-300 hover:text-ink-900",
        )}
      >
        {sent ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
        <span>{busy ? "Sending…" : sent ? "Sent" : "Send to Marketer"}</span>
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={`${titleId}-description`}
        className={cn(styles.dialog, viewportHeight < 540 && styles.compact)}
        onClick={(e) => { e.stopPropagation(); if (e.target === dialogRef.current && !busy) setOpen(false); }}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          if (pickerOpen) closePicker();
          else if (!busy) setOpen(false);
        }}
        onCancel={(e) => { e.preventDefault(); if (pickerOpen) closePicker(); else if (!busy) setOpen(false); }}
        onClose={() => setOpen(false)}
      >
        <header className={styles.header}>
          <span className={styles.headerIcon}><Send size={18} aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold tracking-tight text-ink-900">Send Lead to Marketer</h2>
            <p id={`${titleId}-description`} className="mt-0.5 text-xs text-ink-500">Choose where {count === 1 ? "this lead goes" : `these ${count} leads go`}.</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} disabled={busy} className={styles.iconButton} aria-label="Close send dialog"><X size={18} aria-hidden /></button>
        </header>

        {!state ? <div className={styles.loading} role="status"><Spinner className="h-5 w-5 text-brand-600" /><span>Loading destinations...</span></div> : <>
          <div className={styles.body}>
            {pickerOpen ? <section key="recipients" className={styles.panel} aria-label="Choose a recipient">
              <div className="mb-3 flex items-center justify-between gap-2">
                <button type="button" onClick={closePicker} className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-600 hover:text-brand-700"><ArrowLeft size={14} aria-hidden />Destinations</button>
                <span className="text-xs text-ink-400">Select a marketer or admin</span>
              </div>
              <div className={styles.search}>
                <Search size={16} className="shrink-0 text-ink-400" aria-hidden />
                <input ref={searchRef} type="search" value={query} onChange={(e) => { setQuery(e.target.value); setRecipientPage(0); }} placeholder="Search name, email or role" aria-label="Search marketers and admins" aria-controls={listId} onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); dialogRef.current?.querySelector<HTMLElement>('[role="option"]')?.focus(); }
                }} />
              </div>
              <div id={listId} role="listbox" aria-label="Marketers and admins" className={styles.results} onKeyDown={(e) => {
                if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
                e.preventDefault();
                const options = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'));
                const i = options.indexOf(document.activeElement as HTMLElement);
                const next = e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
                options[next]?.focus();
              }}>
                {visibleRecipients.map((m) => <button key={m.id} type="button" role="option" aria-selected={recipientId === m.id} className={cn(styles.recipient, recipientId === m.id && styles.recipientSelected)} onClick={() => { setRecipient(m.id); closePicker(); }}>
                  <span className={styles.avatar} aria-hidden>{m.name.trim().charAt(0).toUpperCase() || "?"}</span>
                  <span className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-medium text-ink-900" title={m.name}>{m.name}</span><span className="block truncate text-xs text-ink-500" title={m.email}>{m.email}</span></span>
                  <span className={styles.role}>{m.role === "ADMIN" ? "Admin" : "Marketer"}</span>
                  {recipientId === m.id && <Check size={15} className="shrink-0 text-brand-600" aria-hidden />}
                </button>)}
                {!filtered.length && <p className="px-3 py-5 text-center text-sm text-ink-500">{marketers.length ? "No matches. Try another name or role." : "No eligible recipients available."}</p>}
              </div>
              <div className={styles.pagination}>
                <span role="status" aria-live="polite">{filtered.length ? `${currentPage * pageSize + 1}-${Math.min((currentPage + 1) * pageSize, filtered.length)} of ${filtered.length}` : "0 recipients"}</span>
                <div className="flex gap-1"><button type="button" className={styles.iconButton} disabled={currentPage === 0} onClick={() => setRecipientPage(currentPage - 1)} aria-label="Previous recipients"><ChevronLeft size={16} /></button><button type="button" className={styles.iconButton} disabled={currentPage + 1 >= pageCount} onClick={() => setRecipientPage(currentPage + 1)} aria-label="Next recipients"><ChevronRight size={16} /></button></div>
              </div>
            </section> : <div key="destinations" className={styles.panel}>
              <div className={styles.summary}><span className="min-w-0 truncate font-medium text-ink-700" title={companyName}>{companyIds ? `${count} selected leads` : companyName}</span><span className="shrink-0 text-xs text-ink-500">{count} {count === 1 ? "lead" : "leads"}</span></div>
              <fieldset disabled={busy} className={styles.destinations}>
                <legend className="sr-only">Sending destination</legend>
                {([{ value: "shared", title: "Send to Marketer Table", description: "Share with the marketing team", Icon: Table2 }, { value: "individual", title: "Send to Specific Marketer / Admin", description: "Assign directly to one person", Icon: UserRound }] as const).map(({ value, title, description, Icon }) => <label key={value} className={cn(styles.destination, destinationType === value && styles.destinationSelected)}>
                  <input type="radio" name={`${titleId}-destination`} value={value} checked={destinationType === value} onChange={() => setDestination(value)} className={styles.radio} />
                  <Icon size={18} className="shrink-0 text-ink-500" aria-hidden />
                  <span className="min-w-0 flex-1"><span className={styles.optionTitle}>{title}</span><span className={styles.optionDescription}>{description}</span></span>
                  <span className={styles.radioMark} aria-hidden>{destinationType === value && <span />}</span>
                </label>)}
              </fieldset>
              {destinationType === "individual" ? <div className={styles.recipientField}>
                <label htmlFor={`${titleId}-recipient`} className="mb-1.5 block text-xs font-medium text-ink-600">Assign to</label>
                <button ref={pickerTriggerRef} id={`${titleId}-recipient`} type="button" disabled={busy} aria-haspopup="listbox" aria-expanded={pickerOpen} aria-controls={listId} onClick={() => { setQuery(""); setRecipientPage(0); setPickerOpen(true); }} className={styles.pickerTrigger}>
                  <Users size={16} className="shrink-0 text-ink-400" aria-hidden /><span className={cn("min-w-0 flex-1 truncate text-left", !selected && "text-ink-400")}>{selected?.name ?? "Select a marketer or admin"}</span>{selected && <span className={styles.role}>{selected.role === "ADMIN" ? "Admin" : "Marketer"}</span>}<ChevronDown size={16} className="shrink-0 text-ink-400" aria-hidden />
                </button>
              </div> : <div className={styles.sharedInfo}>
                <p className="min-w-0 text-xs leading-relaxed text-ink-500">{state.assignment?.status === "ACTIVE" ? `In the table since ${formatDateTime(state.assignment.sentAt)}.` : viewersText(state.viewers)}</p>
                <Link href="/dashboard/marketer-leads" onClick={() => setOpen(false)} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800">View table<ArrowUpRight size={13} aria-hidden /></Link>
              </div>}
            </div>}
          </div>
          {!pickerOpen && <footer className={styles.footer}>
            {!companyIds && state.assignment?.status === "ACTIVE" && !pickerOpen && <button type="button" disabled={busy} onClick={() => void remove()} className={styles.remove}>Remove from table</button>}
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => pickerOpen ? closePicker() : setOpen(false)}>{pickerOpen ? "Back" : "Cancel"}</Button>
              {!pickerOpen && <Button size="sm" className="h-9 px-4" loading={busy} disabled={destinationType === "individual" && !recipientId} onClick={() => void confirmSend()}>{!busy && <Send size={14} aria-hidden />}Confirm send</Button>}
            </div>
          </footer>}
        </>}
      </dialog>
    </>
  );
}
