import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-ink-100 text-ink-700 ring-ink-200",
  brand: "bg-brand-50 text-brand-700 ring-brand-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
  info: "bg-sky-50 text-sky-700 ring-sky-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  demo: "bg-amber-100 text-amber-900 ring-amber-300",
} as const;

export type BadgeTone = keyof typeof tones;

export function Badge({ tone = "neutral", children, className, dot }: { tone?: BadgeTone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />}
      {children}
    </span>
  );
}

/** Mandatory label for anything generated from demo/mock sources. */
export function DemoBadge({ className, label = "Demo data" }: { className?: string; label?: string }) {
  return (
    <Badge tone="demo" className={className}>
      {label}
    </Badge>
  );
}

const STATUS_TONES: Record<string, BadgeTone> = {
  ACTIVE: "success",
  PENDING_APPROVAL: "warning",
  SUSPENDED: "danger",
  OPEN: "info",
  IN_PROGRESS: "brand",
  WAITING_FOR_CLIENT: "warning",
  RESOLVED: "success",
  CLOSED: "neutral",
  DRAFT: "neutral",
  APPROVED: "brand",
  REJECTED: "danger",
  SENT: "success",
  DELIVERED: "success",
  FAILED: "danger",
  BOUNCED: "danger",
  SUPPRESSED: "danger",
  PLANNED: "neutral",
  ON_HOLD: "warning",
  COMPLETED: "success",
  REQUESTED: "violet",
  PENDING: "warning",
  TODO: "neutral",
  DONE: "success",
  LOW: "neutral",
  NORMAL: "info",
  HIGH: "warning",
  URGENT: "danger",
  SUCCESS: "success",
  PARTIAL: "warning",
  RUNNING: "info",
  NEW: "info",
  IN_REVIEW: "brand",
  CONVERTED: "success",
  ARCHIVED: "neutral",
  PAUSED: "warning",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const text = label ?? status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  return (
    <Badge tone={STATUS_TONES[status] ?? "neutral"} dot>
      {text}
    </Badge>
  );
}
