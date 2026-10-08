import { Check, Minus } from "lucide-react";
import { CONTACT_FIELD_LABELS, completenessStars, type ContactField } from "@/lib/company-fields";
import { cn } from "@/lib/utils";

/** ★★★☆☆ + percentage. Stars are decorative; the percentage carries the meaning. */
export function CompletenessStars({ value, className }: { value: number; className?: string }) {
  const stars = completenessStars(value);
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)} title={`Contact completeness ${value}%`}>
      <span className="text-sm leading-none tracking-tight text-amber-500" aria-hidden>
        {"★".repeat(stars)}
        <span className="text-ink-200">{"★".repeat(5 - stars)}</span>
      </span>
      <span className="text-xs tabular-nums text-ink-600">{value}%</span>
    </span>
  );
}

/** Field-by-field availability checklist (✓ / –). */
export function ContactChecklist({ flags, className }: { flags: Partial<Record<ContactField, boolean>>; className?: string }) {
  const fields: ContactField[] = ["email", "phone", "mobile", "website", "address", "person"];
  return (
    <ul className={cn("grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3", className)}>
      {fields.map((f) => (
        <li key={f} className={cn("flex items-center gap-1.5", flags[f] ? "text-ink-800" : "text-ink-400")}>
          {flags[f] ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> : <Minus className="h-3.5 w-3.5" aria-hidden />}
          {CONTACT_FIELD_LABELS[f]}
          <span className="sr-only">{flags[f] ? "available" : "not available"}</span>
        </li>
      ))}
    </ul>
  );
}

const FRESHNESS: Record<string, { label: string; className: string }> = {
  REAL_TIME: { label: "Real-time", className: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  DAILY: { label: "Daily updated", className: "bg-sky-50 text-sky-800 ring-sky-200" },
  PERIODIC: { label: "Periodic / bulk", className: "bg-violet-50 text-violet-800 ring-violet-200" },
  UNKNOWN: { label: "Freshness unknown", className: "bg-ink-100 text-ink-700 ring-ink-200" },
};

export function FreshnessBadge({ freshness, className }: { freshness?: string | null; className?: string }) {
  const f = FRESHNESS[freshness ?? "UNKNOWN"] ?? FRESHNESS.UNKNOWN!;
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", f.className, className)}>{f.label}</span>;
}

const STATES: Record<string, { label: string; dot: string; text: string }> = {
  CONNECTED: { label: "Connected", dot: "bg-emerald-500", text: "text-emerald-800" },
  NOT_SYNCED: { label: "Connected · not synced yet", dot: "bg-sky-500", text: "text-sky-800" },
  PROVIDER_ERROR: { label: "Provider error", dot: "bg-red-500", text: "text-red-700" },
  NEEDS_CREDENTIALS: { label: "Needs credentials", dot: "bg-amber-500", text: "text-amber-800" },
  NEEDS_APPROVAL: { label: "Needs approval", dot: "bg-amber-500", text: "text-amber-800" },
  LOOKUP_ONLY: { label: "Lookup only", dot: "bg-violet-400", text: "text-violet-800" },
  UNDER_RESEARCH: { label: "Under research", dot: "bg-ink-400", text: "text-ink-600" },
  NO_VERIFIED_FEED: { label: "No verified feed found", dot: "bg-ink-300", text: "text-ink-500" },
};

export function ConnectionDot({ state, className }: { state: string; className?: string }) {
  const s = STATES[state] ?? STATES.UNDER_RESEARCH!;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium", s.text, className)}>
      <span className={cn("h-2 w-2 rounded-full", s.dot)} aria-hidden />
      {s.label}
    </span>
  );
}
