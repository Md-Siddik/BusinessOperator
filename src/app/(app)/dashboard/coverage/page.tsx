import Link from "next/link";
import { requireInternalPage } from "@/lib/auth/session";
import { EVIDENCE_LABELS, INTEGRATION_STATE_LABELS, JURISDICTIONS, type JurisdictionGroup } from "@/config/jurisdictions";
import { listCountries } from "@/features/countries/service";
import { listCountryCards } from "@/features/companies/registrations";
import {
  compareCountries,
  CONTINENT_LABELS,
  CONTINENT_ORDER,
  COUNTRY_STATUS_LABELS,
  COUNTRY_STATUS_MEANINGS,
  countryStatus,
  COVERAGE_TIER_LABELS,
  coverageTier,
  TIMELINESS_LABELS,
  type Continent,
  type CountryRankInput,
  type CountryStatus,
} from "@/lib/integration-state";
import { formatDateTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/data";
import { ConnectionDot } from "@/components/intel/quality";

export const metadata = { title: "Coverage" };

const GROUP_LABELS: Record<JurisdictionGroup, string> = {
  EU: "European Union",
  EEA_EFTA: "EEA / EFTA",
  UK: "United Kingdom",
  CROWN_DEPENDENCY: "Crown dependencies & territories",
  WESTERN_BALKANS: "Western Balkans",
  MICROSTATE: "Microstates",
  EASTERN_EUROPE: "Eastern Europe (owner / legal review)",
  TRANSCONTINENTAL: "Transcontinental (explicit owner decision)",
  NORTH_AMERICA: "North America",
  ASIA: "Asia",
  MIDDLE_EAST: "Middle East",
  OCEANIA: "Oceania",
};

const STATUS_STYLE: Record<CountryStatus, string> = {
  LIVE: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  NOT_SYNCED: "bg-sky-50 text-sky-800 ring-sky-200",
  ERROR: "bg-red-50 text-red-700 ring-red-200",
  READY: "bg-amber-50 text-amber-800 ring-amber-200",
  PAID: "bg-violet-50 text-violet-700 ring-violet-200",
  PARTIAL: "bg-ink-100 text-ink-700 ring-ink-200",
  NA: "bg-ink-50 text-ink-500 ring-ink-200",
};

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * Coverage matrix (Owner only): every jurisdiction ordered by what it actually delivers —
 * verified same-day feeds first, then working feeds with a delay, then partial / unavailable —
 * Europe first inside each tier. Statuses and dates come from the stored sync history; nothing is
 * shown as available unless a source delivered it.
 */
export default async function CoveragePage({ searchParams }: { searchParams: SP }) {
  const actor = await requireInternalPage("companies.read");
  const sp = await searchParams;
  const region = CONTINENT_ORDER.find((c) => c === sp.region) ?? null;
  const [views, cards] = await Promise.all([listCountries(), listCountryCards(actor)]);
  const viewBy = new Map(views.map((v) => [v.code, v]));
  const cardBy = new Map(cards.map((c) => [c.code, c]));

  const rows = JURISDICTIONS.map((j) => {
    const v = viewBy.get(j.code);
    const card = cardBy.get(j.code);
    const rank: CountryRankInput = card ?? {
      name: j.name,
      state: v?.state ?? j.state,
      adapterReady: !!v?.provider && !v.provider.catalogueState && v.provider.capabilities.supportsDailyRegistrations,
      paid: v?.provider?.accessType === "COMMERCIAL",
      lastSuccessAt: v?.lastSuccessAt,
      coverage: null,
      timeliness: j.timeliness,
      continent: j.continent,
    };
    return { j, v, card, rank, tier: coverageTier(rank), status: countryStatus(rank) };
  }).sort((a, b) => compareCountries(a.rank, b.rank));
  const inRegion = rows.filter((r) => !region || r.j.continent === region);
  const counts = (c: Continent | null) => rows.filter((r) => !c || r.j.continent === c).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Company Intelligence"
        title="Coverage"
        description="Where new company registrations come from, how quickly each official source publishes them, and what is not available. A country without data for a day shows “No verified data available” — records are never invented or reused."
      />

      <nav aria-label="Region" className="flex flex-wrap gap-1.5">
        {[null, ...CONTINENT_ORDER].map((c) => (
          <Link
            key={c ?? "all"}
            href={c ? `/dashboard/coverage?region=${c}` : "/dashboard/coverage"}
            aria-current={region === c ? "page" : undefined}
            className={cn("inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm", region === c ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 bg-white text-ink-700 hover:border-ink-300")}
          >
            {c ? CONTINENT_LABELS[c] : "All regions"} <span className="text-xs opacity-70">{counts(c)}</span>
          </Link>
        ))}
      </nav>

      {([1, 2, 3] as const).map((tier) => {
        const list = inRegion.filter((r) => r.tier === tier);
        return (
          <section key={tier} aria-labelledby={`tier-${tier}`} className="space-y-2">
            <div>
              <h2 id={`tier-${tier}`} className="text-base font-semibold text-ink-900">
                {tier}. {COVERAGE_TIER_LABELS[tier].title} <span className="text-sm font-normal text-ink-500">({list.length})</span>
              </h2>
              <p className="text-xs text-ink-500">{COVERAGE_TIER_LABELS[tier].description}</p>
            </div>
            {list.length === 0 ? (
              <p className="rounded-xl border border-dashed border-ink-200 px-4 py-3 text-sm text-ink-500">No countries in this tier{region ? ` for ${CONTINENT_LABELS[region]}` : ""}.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="bg-ink-50 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                    <tr>
                      <th className="px-3 py-2">Country</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Update window</th>
                      <th className="px-3 py-2">Registered today</th>
                      <th className="px-3 py-2">Last successful sync</th>
                      <th className="px-3 py-2">Latest source publication</th>
                      <th className="px-3 py-2">Official source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100 align-top">
                    {list.map(({ j, v, card, status }) => (
                      <tr key={j.code}>
                        <td className="px-3 py-2.5">
                          <Link href={`/dashboard/companies/${j.code.toLowerCase()}`} className="font-medium text-ink-900 hover:text-brand-700 hover:underline">
                            <span aria-hidden>{j.flag}</span> {j.name}
                          </Link>
                          <p className="text-[11px] text-ink-500">{CONTINENT_LABELS[j.continent]}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          <span title={COUNTRY_STATUS_MEANINGS[status]} className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset", STATUS_STYLE[status])}>
                            {COUNTRY_STATUS_LABELS[status]}
                          </span>
                          <p className="mt-1 text-[11px] text-ink-500">{EVIDENCE_LABELS[j.evidence]}</p>
                        </td>
                        <td className="max-w-[260px] px-3 py-2.5 text-ink-700">
                          <span className="font-medium text-ink-900">{TIMELINESS_LABELS[j.timeliness]}</span>
                          <p className="text-xs text-ink-600">{j.updateWindow}</p>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">{status === "LIVE" ? (card?.today !== null && card?.today !== undefined ? <span className="font-semibold text-ink-900">{card.today}</span> : <span className="text-xs text-ink-500">Not synced yet today</span>) : <span className="text-xs text-ink-500">No verified data available</span>}</td>
                        <td className="px-3 py-2.5 text-xs text-ink-600">{v?.lastSuccessAt ? formatDateTime(v.lastSuccessAt) : "Never"}</td>
                        <td className="px-3 py-2.5 text-xs text-ink-600">{v?.latestPublicationAt ? formatDateTime(v.latestPublicationAt) : "—"}</td>
                        <td className="max-w-[280px] px-3 py-2.5 text-xs">
                          <a href={j.sources?.[0] ?? j.registry.url} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">
                            {v?.provider?.sourceName ?? j.registry.name}
                          </a>
                          {status !== "LIVE" && v?.stateMessage && <p className="mt-1 text-ink-500">{v.stateMessage}</p>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      <details className="rounded-xl border border-ink-200 bg-white">
        <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold text-ink-900">Research details for every jurisdiction</summary>
        <div className="space-y-6 border-t border-ink-100 p-4">
          <p className="text-xs text-ink-500">Evidence levels: {Object.values(EVIDENCE_LABELS).join(" → ")}. &ldquo;Not yet verified&rdquo; means the field has not been checked against official documentation.</p>
          {[...new Set(JURISDICTIONS.filter((j) => !region || j.continent === region).map((j) => j.group))].map((g) => (
            <section key={g} className="space-y-2">
              <h3 className="text-sm font-semibold text-ink-900">{GROUP_LABELS[g]}</h3>
              <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white">
                <table className="w-full min-w-[1200px] text-left text-xs">
                  <thead className="bg-ink-50 font-semibold uppercase tracking-wide text-ink-500">
                    <tr>
                      <th className="px-3 py-2">Jurisdiction</th>
                      <th className="px-3 py-2">State (runtime)</th>
                      <th className="px-3 py-2">Evidence</th>
                      <th className="px-3 py-2">Official registry</th>
                      <th className="px-3 py-2">API / feed</th>
                      <th className="px-3 py-2">Registration date means</th>
                      <th className="px-3 py-2">Contact fields</th>
                      <th className="px-3 py-2">Update frequency</th>
                      <th className="px-3 py-2">Access</th>
                      <th className="px-3 py-2">Permitted use</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100 align-top">
                    {JURISDICTIONS.filter((j) => j.group === g).map((j) => {
                      const rt = viewBy.get(j.code);
                      return (
                        <tr key={j.code} id={j.code}>
                          <td className="px-3 py-2 text-sm font-medium text-ink-900">
                            <span aria-hidden>{j.flag}</span> {j.name}
                            {j.scope !== "IN_SCOPE" && <p className="text-[11px] font-normal text-amber-700">{j.scope.replace(/_/g, " ").toLowerCase()}</p>}
                            {rt && !rt.enabled && <p className="text-[11px] font-normal text-ink-400">disabled</p>}
                          </td>
                          <td className="px-3 py-2">{rt ? <ConnectionDot state={rt.state} /> : INTEGRATION_STATE_LABELS[j.state]}</td>
                          <td className="px-3 py-2">{EVIDENCE_LABELS[j.evidence]}</td>
                          <td className="px-3 py-2">
                            <a href={j.registry.url} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">
                              {j.registry.name}
                            </a>
                          </td>
                          <td className="max-w-[260px] px-3 py-2 text-ink-700">{j.feed}</td>
                          <td className="max-w-[200px] px-3 py-2 text-ink-700">{j.registrationDateMeaning}</td>
                          <td className="max-w-[200px] px-3 py-2 text-ink-700">{j.contactFields}</td>
                          <td className="max-w-[180px] px-3 py-2 text-ink-700">{j.updateFrequency}</td>
                          <td className="max-w-[200px] px-3 py-2 text-ink-700">{j.access}</td>
                          <td className="max-w-[220px] px-3 py-2 text-ink-700">
                            {j.permittedUse}
                            {j.notes && <p className="mt-1 text-ink-500">{j.notes}</p>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      </details>
    </div>
  );
}
