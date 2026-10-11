import { ownerMetadata } from "@/features/opportunities/metadata";
import { requireOwnerPage } from "@/lib/auth/session";
import { getCountryCoverage } from "@/features/opportunities/service";
import { COVERAGE_LABELS, OPPORTUNITY_TYPE_LABELS } from "@/features/opportunities/constants";
import { formatAge, formatInterval } from "@/features/opportunities/format";
import { PageHeader } from "@/components/ui/data";
import { CountrySupportBadge, ProviderStateBadge } from "@/components/opportunities/badges";

export const generateMetadata = ownerMetadata("Opportunity countries");

const REMOVAL: Record<string, string> = { EXPLICIT: "explicit removals", LISTING_DIFF: "listing diff", DEADLINE_ONLY: "deadline only", NONE: "no closure data" };
const IDENTITY: Record<string, string> = { REGISTRATION_NUMBER: "registration number", ATS_BOARD_OWNER: "ATS board owner", OFFICIAL_DOMAIN: "official domain", NAME_ONLY: "name only" };

/**
 * Country × opportunity type status. "Fully operational" requires a national official
 * source that is configured AND synchronizing successfully — a flag in the list is not coverage.
 */
export default async function CountriesPage() {
  const actor = await requireOwnerPage();
  const rows = await getCountryCoverage(actor);
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Opportunity Intelligence"
        title="Countries"
        description="What each country actually has: which sources cover which opportunity type, at what coverage level, whether they are configured and synchronizing, and what is still missing. Fully operational = a national official source is configured and syncing successfully."
      />
      <div className="space-y-4">
        {rows.map((c) => (
          <section key={c.code} aria-labelledby={`c-${c.code}`} className="rounded-2xl border border-ink-200 bg-white">
            <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink-100 px-5 py-3">
              <h2 id={`c-${c.code}`} className="text-base font-semibold text-ink-900">
                <span aria-hidden>{c.flag}</span> {c.name}
              </h2>
              <span className="text-xs text-ink-500">Dates and “today” evaluated in {c.timezone}</span>
            </header>
            <div className="grid gap-0 lg:grid-cols-2 lg:divide-x lg:divide-ink-100">
              {c.types.map((t) => (
                <div key={t.type} className="space-y-3 px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-ink-800">{OPPORTUNITY_TYPE_LABELS[t.type]}</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs tabular-nums text-ink-500">{t.open} open</span>
                      <CountrySupportBadge support={t.support} />
                    </div>
                  </div>
                  <p className="text-xs text-ink-600">{t.type === "HIRING" ? c.hiringNotes : c.procurementNotes}</p>
                  {t.providers.length ? (
                    <ul className="space-y-2">
                      {t.providers.map((p) => (
                        <li key={p.id} className="rounded-lg border border-ink-100 px-3 py-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-medium text-ink-800">{p.name}</span>
                            <ProviderStateBadge state={p.state} />
                          </div>
                          <p className="mt-0.5 text-xs text-ink-600">
                            {COVERAGE_LABELS[p.level]} — {p.note}
                          </p>
                          <p className="mt-1 text-xs text-ink-500">
                            Sync {formatInterval(p.intervalMinutes)} · last success {p.lastSuccessAt ? formatAge(p.lastSuccessAt) : "never"} · closure: {REMOVAL[p.removalDetection]} · status check: {p.activityCheck ? "yes" : "no"} · identity: {IDENTITY[p.employerIdentity]}
                          </p>
                          {p.lastError && p.state !== "OPERATIONAL" && <p className="mt-1 text-xs text-red-700">Last error: {p.lastError}</p>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-ink-500">No national or regional source integrated for this type.</p>
                  )}
                  <p className="text-xs text-ink-500">
                    Employer feeds with records here: <span className="font-medium text-ink-700">{t.employerFeeds}</span> (ATS boards and careers pages you add — selected employers only).
                  </p>
                  {t.candidates.length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-ink-600">Not yet integrated ({t.candidates.length})</summary>
                      <ul className="mt-1 space-y-1 pl-3">
                        {t.candidates.map((s) => (
                          <li key={s.name} className="text-ink-600">
                            <span className="font-medium text-ink-700">{s.name}</span> — {s.status.replace(/_/g, " ").toLowerCase()}: {s.reason}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
