"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bookmark, BookmarkCheck, RefreshCw, Send, Trash2 } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { MANUAL_VERIFICATION_LABELS, MANUAL_VERIFICATION_RESULTS, REVIEW_STATUS_LABELS, REVIEW_STATUSES } from "@/features/opportunities/constants";
import { formatInZone } from "@/features/opportunities/format";

function useAction() {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  async function run(key: string, fn: () => Promise<unknown>, ok?: string | ((r: unknown) => string)) {
    setPending(key);
    try {
      const r = await fn();
      if (ok) toast.success(typeof ok === "function" ? ok(r) : ok);
      router.refresh();
      return r;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setPending(null);
    }
  }
  return { pending, run };
}

/** Save, review status, re-check at source, add to CRM. */
export function OpportunityActions({ id, saved, reviewStatus, hasCheck, canCrm }: { id: string; saved: boolean; reviewStatus: string; hasCheck: boolean; canCrm: boolean }) {
  const { pending, run } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant={saved ? "secondary" : "outline"} loading={pending === "save"} aria-pressed={saved} onClick={() => run("save", () => apiFetch(`/api/opportunities/${id}`, { method: "PATCH", body: { saved: !saved } }), saved ? "Removed from saved" : "Saved")}>
        {saved ? <BookmarkCheck className="h-4 w-4 text-brand-600" aria-hidden /> : <Bookmark className="h-4 w-4" aria-hidden />}
        {saved ? "Saved" : "Save"}
      </Button>
      <label className="sr-only" htmlFor="review-status">
        Review status
      </label>
      <select
        id="review-status"
        value={reviewStatus}
        disabled={pending !== null}
        onChange={(e) => run("review", () => apiFetch(`/api/opportunities/${id}`, { method: "PATCH", body: { reviewStatus: e.target.value } }), "Review status updated")}
        className="h-8 rounded-lg border border-ink-200 bg-white px-2.5 text-sm shadow-soft"
      >
        {REVIEW_STATUSES.map((s) => (
          <option key={s} value={s}>
            {REVIEW_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      {hasCheck && (
        <Button size="sm" variant="outline" loading={pending === "check"} onClick={() => run("check", () => apiFetch<{ status: string; detail: string }>(`/api/opportunities/${id}/check`, { body: {} }), (r) => `Source check: ${(r as { detail: string }).detail}`)}>
          <RefreshCw className="h-4 w-4" aria-hidden /> Re-check at source
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        loading={pending === "crm"}
        disabled={!canCrm}
        title={canCrm ? "Adds a CRM note with source, evidence and contact provenance (visible to CRM users)" : "Requires a reliable link to a Company Intelligence record"}
        onClick={() => run("crm", () => apiFetch(`/api/opportunities/${id}/crm`, { body: {} }), "Added to CRM with source and evidence")}
      >
        <Send className="h-4 w-4" aria-hidden /> Add to CRM
      </Button>
    </div>
  );
}

export function ManualVerificationForm({ id, current }: { id: string; current?: string }) {
  const { pending, run } = useAction();
  const [result, setResult] = useState(current ?? "");
  const [note, setNote] = useState("");
  return (
    <form
      className="space-y-2 rounded-xl border border-ink-200 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!result) return;
        void run("verify", () => apiFetch(`/api/opportunities/${id}/verify`, { body: { result, note: note || undefined } }), "Assessment recorded").then(() => setNote(""));
      }}
    >
      <fieldset>
        <legend className="text-sm font-medium text-ink-800">Your assessment</legend>
        <p className="text-xs text-ink-500">Recorded as owner evidence. It does not change what the source says.</p>
        <div className="mt-2 flex flex-wrap gap-3">
          {MANUAL_VERIFICATION_RESULTS.map((r) => (
            <label key={r} className="flex items-center gap-1.5 text-sm text-ink-700">
              <input type="radio" name="manual-result" value={r} checked={result === r} onChange={() => setResult(r)} className="accent-brand-600" />
              {MANUAL_VERIFICATION_LABELS[r]}
            </label>
          ))}
        </div>
      </fieldset>
      <label htmlFor="manual-note" className="sr-only">
        Note
      </label>
      <Textarea id="manual-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you check? (e.g. confirmed on the employer's careers page)" className="min-h-16" maxLength={2000} />
      <Button type="submit" size="sm" disabled={!result} loading={pending === "verify"}>
        Record assessment
      </Button>
    </form>
  );
}

export function OpportunityNotes({ id, notes, timeZone }: { id: string; notes: { _id: string; text: string; at: string }[]; timeZone: string }) {
  const { pending, run } = useAction();
  const [text, setText] = useState("");
  return (
    <Card>
      <CardHeader title="Research notes" description="Private to the owner." />
      <CardContent className="space-y-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            void run("note", () => apiFetch(`/api/opportunities/${id}/notes`, { body: { text } }), "Note added").then(() => setText(""));
          }}
          className="space-y-2"
        >
          <label htmlFor="note-text" className="sr-only">
            New note
          </label>
          <Textarea id="note-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a research note…" maxLength={5000} className="min-h-20" />
          <Button type="submit" size="sm" disabled={!text.trim()} loading={pending === "note"}>
            Add note
          </Button>
        </form>
        {notes.length > 0 && (
          <ul className="space-y-2">
            {[...notes].reverse().map((n) => (
              <li key={n._id} className="rounded-lg bg-ink-50 px-3 py-2 text-sm">
                <p className="whitespace-pre-line text-ink-800">{n.text}</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-xs text-ink-400">{formatInZone(n.at, timeZone)}</span>
                  <button type="button" className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-red-600" aria-label="Delete note" disabled={pending !== null} onClick={() => run(`del-${n._id}`, () => apiFetch(`/api/opportunities/${id}/notes/${n._id}`, { method: "DELETE" }), "Note deleted")}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
