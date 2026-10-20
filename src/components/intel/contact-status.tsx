import { CheckCircle2, Clock, FileText, MinusCircle, Search } from "lucide-react";
import { EMAIL_VERIFICATION_LABELS, ELIGIBILITY_LABELS, RESEARCH_STATUS_LABELS, type EligibilityState, type EmailVerification, type ResearchStatus } from "@/lib/company-fields";
import { cn } from "@/lib/utils";
import type { CompanyRow } from "./types";

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");

/** Direct-contact group, verification state and research status — stated precisely, never as icons alone. */
export function ContactStatus({ row, compact }: { row: CompanyRow; compact?: boolean }) {
  const d = row.direct;
  const channels = d.hasEmail && d.hasPhone ? "email + phone" : d.hasEmail ? "email" : d.hasPhone ? "phone" : "";
  const research = row.research.status as ResearchStatus;
  // Honest wording: "not found" only after at least one completed research attempt.
  const researched = row.research.attempts > 0 && research !== "SEARCHING" && research !== "NOT_STARTED";
  return (
    <div className="space-y-1 text-xs">
      {d.has ? (
        <p className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-800">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Direct contact · {channels}
        </p>
      ) : d.formOnly ? (
        <p className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 font-medium text-sky-800">
          <FileText className="h-3.5 w-3.5" aria-hidden /> Contact form only
        </p>
      ) : researched ? (
        <p className="inline-flex items-center gap-1 rounded-md bg-ink-100 px-1.5 py-0.5 font-medium text-ink-600">
          <MinusCircle className="h-3.5 w-3.5" aria-hidden /> No public contact found
        </p>
      ) : (
        <p className="inline-flex items-center gap-1 rounded-md bg-ink-100 px-1.5 py-0.5 font-medium text-ink-600">
          <Search className="h-3.5 w-3.5" aria-hidden /> Research pending
        </p>
      )}
      {d.hasEmail && d.emailVerification && <p className={cn(d.emailVerification === "DELIVERABLE" ? "text-emerald-700" : "text-ink-500")}>Email: {EMAIL_VERIFICATION_LABELS[d.emailVerification as EmailVerification] ?? d.emailVerification}</p>}
      {d.pendingVerification && <p className="text-amber-700">Verification pending</p>}
      {!compact && (
        <p className="flex items-center gap-1 text-ink-500">
          {research === "SEARCHING" ? <Search className="h-3 w-3" aria-hidden /> : <Clock className="h-3 w-3" aria-hidden />}
          {RESEARCH_STATUS_LABELS[research] ?? research}
          {row.research.nextRetryAt && ["RETRY_SCHEDULED", "NO_CONTACT_YET", "PARTIAL", "BUDGET_PAUSED", "PROVIDER_UNAVAILABLE", "RESEARCH_UNAVAILABLE", "VERIFICATION_PENDING"].includes(research) && <span>· next {fmtDate(row.research.nextRetryAt)}</span>}
        </p>
      )}
      {row.contactFormUrl && !d.has && (
        <a href={row.contactFormUrl} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()} className="block text-brand-700 hover:underline">
          Open contact form
        </a>
      )}
      {row.eligibility !== "NEEDS_REVIEW" && <p className={cn(row.eligibility === "CLEARED" ? "text-emerald-700" : "text-red-700")}>{ELIGIBILITY_LABELS[row.eligibility as EligibilityState]}</p>}
    </div>
  );
}
