"use client";

import { useState } from "react";
import { Bookmark, BookmarkCheck, CircleHelp, ThumbsDown, ThumbsUp, Trophy } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { RELEVANCE_LABELS, type Relevance } from "@/lib/company-fields";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const OPTIONS: { value: Relevance; icon: typeof ThumbsUp; active: string }[] = [
  { value: "RELEVANT", icon: ThumbsUp, active: "border-emerald-300 bg-emerald-50 text-emerald-800" },
  { value: "MAYBE", icon: CircleHelp, active: "border-amber-300 bg-amber-50 text-amber-800" },
  { value: "NOT_RELEVANT", icon: ThumbsDown, active: "border-ink-300 bg-ink-100 text-ink-700" },
];

/**
 * Quick research decisions on a company: Relevant / Maybe / Not relevant,
 * save as lead, and (for users who may manage the lead) mark as a qualified lead in the CRM.
 */
export function QualifyButtons({
  companyId,
  relevance: initialRelevance,
  saved: initialSaved,
  stage: initialStage,
  canQualify,
  size = "sm",
  onChange,
}: {
  companyId: string;
  relevance?: Relevance;
  saved: boolean;
  stage: string;
  canQualify: boolean;
  size?: "sm" | "md";
  onChange?: (patch: { relevance?: Relevance; saved?: boolean; stage?: string }) => void;
}) {
  const toast = useToast();
  const [relevance, setRelevance] = useState<Relevance | undefined>(initialRelevance);
  const [saved, setSaved] = useState(initialSaved);
  const [stage, setStage] = useState(initialStage);
  const [busy, setBusy] = useState(false);

  async function send(body: Record<string, unknown>, rollback: () => void) {
    setBusy(true);
    try {
      await apiFetch(`/api/companies/${companyId}/qualify`, { body });
    } catch (e) {
      rollback();
      toast.error(e instanceof ApiError ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  function chooseRelevance(v: Relevance) {
    const prev = relevance;
    const next = prev === v ? undefined : v;
    setRelevance(next);
    onChange?.({ relevance: next });
    void send({ relevance: next ?? "CLEAR" }, () => setRelevance(prev));
  }

  function toggleSaved() {
    const prev = saved;
    setSaved(!prev);
    onChange?.({ saved: !prev });
    void send({ saved: !prev }, () => setSaved(prev));
  }

  async function qualify() {
    setBusy(true);
    try {
      await apiFetch(`/api/crm/${companyId}/stage`, { body: { stage: "QUALIFIED", note: "Qualified from the daily registrations list" } });
      setStage("QUALIFIED");
      setSaved(true);
      onChange?.({ stage: "QUALIFIED", saved: true });
      if (!saved) await apiFetch(`/api/companies/${companyId}/qualify`, { body: { saved: true } });
      toast.success("Added to the CRM as a qualified lead");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not qualify");
    } finally {
      setBusy(false);
    }
  }

  const btn = size === "sm" ? "h-7 px-1.5 text-[11px]" : "h-8 px-2.5 text-xs";
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Qualification">
      {OPTIONS.map((o) => {
        const Icon = o.icon;
        const active = relevance === o.value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              chooseRelevance(o.value);
            }}
            aria-pressed={active}
            title={RELEVANCE_LABELS[o.value]}
            className={cn("inline-flex items-center gap-1 rounded-md border font-medium transition-colors disabled:opacity-60", btn, active ? o.active : "border-ink-200 bg-white text-ink-500 hover:border-ink-300 hover:text-ink-800")}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            <span className={size === "sm" ? "sr-only xl:not-sr-only" : undefined}>{RELEVANCE_LABELS[o.value]}</span>
          </button>
        );
      })}
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          toggleSaved();
        }}
        aria-pressed={saved}
        title={saved ? "Saved as lead — click to remove" : "Save as lead"}
        className={cn("inline-flex items-center gap-1 rounded-md border font-medium transition-colors disabled:opacity-60", btn, saved ? "border-brand-300 bg-brand-50 text-brand-800" : "border-ink-200 bg-white text-ink-500 hover:border-ink-300 hover:text-ink-800")}
      >
        {saved ? <BookmarkCheck className="h-3.5 w-3.5" aria-hidden /> : <Bookmark className="h-3.5 w-3.5" aria-hidden />}
        <span className={size === "sm" ? "sr-only" : undefined}>{saved ? "Saved" : "Save lead"}</span>
      </button>
      {canQualify && stage === "NEW" && (
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            void qualify();
          }}
          title="Mark as qualified lead (adds it to the CRM pipeline)"
          className={cn("inline-flex items-center gap-1 rounded-md border border-brand-200 bg-white font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-60", btn)}
        >
          <Trophy className="h-3.5 w-3.5" aria-hidden />
          <span className={size === "sm" ? "sr-only" : undefined}>Qualified lead</span>
        </button>
      )}
      {stage !== "NEW" && size === "md" && <span className="ml-1 text-xs text-ink-500">In CRM: {stage.replace(/_/g, " ").toLowerCase()}</span>}
    </div>
  );
}
