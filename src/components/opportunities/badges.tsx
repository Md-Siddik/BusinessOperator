import { AlertTriangle, BadgeCheck, Building2, CircleDot, CircleSlash, Clock, Eye, ShieldCheck, ShieldQuestion, XCircle, type LucideIcon } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { getOpportunityCountry } from "@/config/opportunity-countries";
import {
  ACTIVITY_LABELS,
  COUNTRY_SUPPORT_LABELS,
  EMPLOYER_IDENTITY_LABELS,
  PROVIDER_STATE_LABELS,
  SOURCE_CLASS_HELP,
  SOURCE_CLASS_LABELS,
  VERIFICATION_LABEL_TEXT,
  type ActivityStatus,
  type CountrySupport,
  type EmployerIdentity,
  type ProviderState,
  type SourceClass,
  type VerificationLabel,
} from "@/features/opportunities/constants";
import { cn } from "@/lib/utils";

/**
 * Trust badges. Each dimension has its own badge — there is deliberately no single
 * combined "verified" badge (an official source is not proof of current activity).
 */
const LABEL_STYLE: Record<VerificationLabel, { tone: BadgeTone; icon: LucideIcon }> = {
  VERIFIED_OFFICIAL_SOURCE: { tone: "success", icon: ShieldCheck },
  EMPLOYER_IDENTITY_CONFIRMED: { tone: "brand", icon: Building2 },
  ACTIVE_STATUS_CHECKED: { tone: "info", icon: BadgeCheck },
  NEEDS_MANUAL_REVIEW: { tone: "warning", icon: Eye },
  UNVERIFIED: { tone: "neutral", icon: ShieldQuestion },
  CLOSED_OR_EXPIRED: { tone: "neutral", icon: CircleSlash },
  REMOVED_AT_SOURCE: { tone: "danger", icon: XCircle },
};

export function VerificationBadge({ label, compact }: { label: VerificationLabel; compact?: boolean }) {
  const s = LABEL_STYLE[label];
  const Icon = s.icon;
  return (
    <Badge tone={s.tone} className={compact ? "px-1.5" : undefined}>
      <Icon className="h-3 w-3" aria-hidden />
      {VERIFICATION_LABEL_TEXT[label]}
    </Badge>
  );
}

export function VerificationBadges({ labels, compact, className }: { labels: string[]; compact?: boolean; className?: string }) {
  const order = Object.keys(LABEL_STYLE) as VerificationLabel[];
  const sorted = order.filter((l) => labels.includes(l));
  if (!sorted.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1", className)} aria-label="Verification">
      {sorted.map((l) => (
        <li key={l}>
          <VerificationBadge label={l} compact={compact} />
        </li>
      ))}
    </ul>
  );
}

const ACTIVITY_STYLE: Record<ActivityStatus, { tone: BadgeTone; icon: LucideIcon }> = {
  ACTIVE: { tone: "success", icon: CircleDot },
  UNKNOWN: { tone: "neutral", icon: ShieldQuestion },
  EXPIRED: { tone: "neutral", icon: Clock },
  CLOSED: { tone: "danger", icon: XCircle },
};

export function ActivityBadge({ activity }: { activity: string }) {
  const a = (activity in ACTIVITY_STYLE ? activity : "UNKNOWN") as ActivityStatus;
  const Icon = ACTIVITY_STYLE[a].icon;
  return (
    <Badge tone={ACTIVITY_STYLE[a].tone}>
      <Icon className="h-3 w-3" aria-hidden />
      {ACTIVITY_LABELS[a]}
    </Badge>
  );
}

export function SourceClassBadge({ sourceClass }: { sourceClass: string }) {
  const c = sourceClass as SourceClass;
  const official = c !== "THIRD_PARTY_AGGREGATOR" && c !== "UNVERIFIED_SOURCE";
  return (
    <span title={SOURCE_CLASS_HELP[c]} className={cn("inline-flex items-center gap-1 text-xs", official ? "text-ink-700" : "text-amber-800")}>
      {!official && <AlertTriangle className="h-3 w-3" aria-hidden />}
      {SOURCE_CLASS_LABELS[c] ?? sourceClass}
    </span>
  );
}

export function EmployerIdentityText({ identity }: { identity: string }) {
  const i = identity as EmployerIdentity;
  return <span className={cn("text-xs", i === "CONFIRMED" ? "text-emerald-700" : i === "REGISTRATION_NUMBER_PROVIDED" ? "text-ink-700" : "text-ink-500")}>{EMPLOYER_IDENTITY_LABELS[i] ?? identity}</span>;
}

const STATE_TONES: Record<ProviderState, BadgeTone> = {
  OPERATIONAL: "success",
  CONFIGURED_NOT_SYNCED: "info",
  DISABLED: "neutral",
  NEEDS_CREDENTIALS: "warning",
  NEEDS_AGREEMENT: "warning",
  PROVIDER_ERROR: "danger",
  NOT_IMPLEMENTED: "neutral",
};

export function ProviderStateBadge({ state }: { state: string }) {
  const s = state as ProviderState;
  return (
    <Badge tone={STATE_TONES[s] ?? "neutral"} dot>
      {PROVIDER_STATE_LABELS[s] ?? state}
    </Badge>
  );
}

export function CountrySupportBadge({ support }: { support: string }) {
  const s = support as CountrySupport;
  const tone: BadgeTone = s === "FULLY_OPERATIONAL" ? "success" : s === "PARTIALLY_OPERATIONAL" ? "warning" : "neutral";
  return (
    <Badge tone={tone} dot>
      {COUNTRY_SUPPORT_LABELS[s] ?? support}
    </Badge>
  );
}

export function CountryTag({ code }: { code?: string | null }) {
  const c = getOpportunityCountry(code);
  if (!c) return <span className="text-xs text-ink-400">—</span>;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-ink-700">
      <span aria-hidden>{c.flag}</span>
      {c.name}
    </span>
  );
}
