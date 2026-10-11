import { requireInternalPage } from "@/lib/auth/session";
import { EVIDENCE_LABELS, INTEGRATION_STATE_LABELS, JURISDICTIONS, type JurisdictionGroup } from "@/config/jurisdictions";
import { listCountries } from "@/features/countries/service";
import { PageHeader } from "@/components/ui/data";
import { ConnectionDot } from "@/components/intel/quality";

export const metadata = { title: "European coverage" };

const GROUP_LABELS: Record<JurisdictionGroup, string> = {
  EU: "European Union",
  EEA_EFTA: "EEA / EFTA",
  UK: "United Kingdom",
  CROWN_DEPENDENCY: "Crown dependencies & territories",
  WESTERN_BALKANS: "Western Balkans",
  MICROSTATE: "Microstates",
  EASTERN_EUROPE: "Eastern Europe (owner / legal review)",
  TRANSCONTINENTAL: "Transcontinental (explicit owner decision)",
};

/** Jurisdiction catalogue: official registry, feed, date meaning, contacts, freshness, access, permitted use, state and evidence. */
export default async function CoveragePage() {
  await requireInternalPage("companies.read");
  const runtime = new Map((await listCountries()).map((c) => [c.code, c]));
  const groups = [...new Set(JURISDICTIONS.map((j) => j.group))];
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Company Intelligence"
        title="European coverage"
        description="Every European jurisdiction with its official registry and what is actually known about it. Appearing here is not an integration — the state and evidence level say exactly how far each one has been verified."
      />
      <p className="text-xs text-ink-500">Evidence levels: {Object.values(EVIDENCE_LABELS).join(" → ")}. &ldquo;Not yet verified&rdquo; means the field has not been checked against official documentation.</p>
      {groups.map((g) => (
        <section key={g} className="space-y-2">
          <h2 className="text-base font-semibold text-ink-900">{GROUP_LABELS[g]}</h2>
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
                  const rt = runtime.get(j.code);
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
  );
}
