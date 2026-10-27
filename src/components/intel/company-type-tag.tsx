import { Building2, CircleHelp, Rocket } from "lucide-react";
import { COMPANY_TYPE_LABELS, type CompanyType } from "@/lib/company-classification";
import { CONTACT_STATUS_LABELS, type ContactStatus } from "@/lib/company-fields";
import { cn } from "@/lib/utils";

/**
 * Company Type tag — the same compact, colored tag everywhere a company is listed
 * (Company Intelligence, Digital Marketer). Text label + icon, never color alone.
 * Startup: fuchsia/violet accent · Established Company: teal · Needs Review: amber.
 */
const TYPE_STYLE: Record<CompanyType, { className: string; Icon: typeof Rocket }> = {
  STARTUP: { className: "bg-gradient-to-r from-fuchsia-50 to-violet-50 text-violet-800 ring-violet-200", Icon: Rocket },
  ESTABLISHED: { className: "bg-gradient-to-r from-teal-50 to-cyan-50 text-teal-800 ring-teal-200", Icon: Building2 },
  NEEDS_REVIEW: { className: "bg-amber-50 text-amber-800 ring-amber-200", Icon: CircleHelp },
};

/** Short labels for dense tables (Client Leads): same classification and colours. */
const SHORT_LABELS: Record<CompanyType, string> = { STARTUP: "Startup", ESTABLISHED: "Established", NEEDS_REVIEW: "Needs review" };

export function CompanyTypeTag({ value, reason, manual, className, short }: { value: CompanyType; reason?: string; manual?: boolean; className?: string; short?: boolean }) {
  const { className: tone, Icon } = TYPE_STYLE[value];
  return (
    <span
      title={reason ? `${reason}${manual ? " (manual decision)" : ""}` : undefined}
      className={cn("inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", tone, className)}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{short ? SHORT_LABELS[value] : COMPANY_TYPE_LABELS[value]}</span>
      {manual && <span className="sr-only"> (manual decision)</span>}
    </span>
  );
}

const STATUS_STYLE: Record<ContactStatus, string> = {
  VERIFIED: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  UNVERIFIED: "bg-sky-50 text-sky-800 ring-sky-200",
  NEEDS_REVIEW: "bg-amber-50 text-amber-800 ring-amber-200",
  NOT_PUBLICLY_AVAILABLE: "bg-ink-100 text-ink-600 ring-ink-200",
  PENDING: "bg-white text-ink-500 ring-ink-200",
};

export function ContactStatusTag({ value, className }: { value: ContactStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", STATUS_STYLE[value], className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", value === "VERIFIED" ? "bg-emerald-500" : value === "UNVERIFIED" ? "bg-sky-500" : value === "NEEDS_REVIEW" ? "bg-amber-500" : "bg-ink-300")} aria-hidden />
      {CONTACT_STATUS_LABELS[value]}
    </span>
  );
}
