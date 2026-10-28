import Link from "next/link";
import { Building2, Download, ExternalLink, SearchX } from "lucide-react";
import { COUNTRIES, getCountry } from "@/config/countries";
import { getEnabledCountries } from "@/features/countries/service";
import { listOldCompanies, OLD_COMPANY_SORTS } from "@/features/established/service";
import { establishedCoverage } from "@/features/registry/established";
import { can, isOwner, type Actor } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { safeExternalUrl } from "@/lib/utils/url";
import { formatDateTime, formatNumber } from "@/lib/utils/format";
import { buttonClasses, ButtonLink } from "@/components/ui/button";
import { Pagination, withParams } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";
import { OldCompanyThreshold } from "./old-company-threshold";

type SP = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);
const SORT_LABELS: Record<(typeof OLD_COMPANY_SORTS)[number], string> = { oldest: "Oldest first", newest: "Most recent first", name: "Company A–Z" };

/**
 * Old company Intelligence. Reads ONLY the established-company dataset (features/established),
 * which is collected separately from historical registry windows and never contains a Startup
 * Company Intelligence record. No data → an empty state, never startup companies.
 */
export async function OldCompanyWorkspace({ actor, country, searchParams }: { actor: Actor; country: string; searchParams: SP }) {
  const code = country.toUpperCase();
  const input = { country: code, q: str(searchParams.q), sort: str(searchParams.sort), minAge: str(searchParams.minAge), page: str(searchParams.page) };
  const [list, enabled, coverage] = await Promise.all([listOldCompanies(actor, input), getEnabledCountries(), establishedCoverage()]);
  const basePath = `/dashboard/old-companies/${code === "ALL" ? "all" : code.toLowerCase()}`;
  const name = code === "ALL" ? "All countries" : (getCountry(code)?.name ?? code);
  const exportHref = withParams("/api/old-companies/export", { country: code, q: input.q, sort: input.sort, minAge: input.minAge }, {});
  const collecting = coverage.filter((c) => c.collecting && enabled.some((e) => e.code === c.code));
  const shown = code === "ALL" ? coverage.filter((c) => enabled.some((e) => e.code === c.code)) : coverage.filter((c) => c.code === code);

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-700">Old company Intelligence</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-900">{name} — established companies</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-600">
            Businesses registered at least {list.minAgeYears} years ago that the official registry still lists as active, collected from historical registry records. Kept separate from Startup Company Intelligence: a company held there never appears here.
          </p>
        </div>
        {isOwner(actor) && <OldCompanyThreshold value={list.config.minAgeYears} pinned={list.config.pinnedByEnv} />}
      </header>

      <nav aria-label="Country" className="scroll-thin -mx-1 overflow-x-auto px-1">
        <ul className="flex min-w-max gap-1.5">
          {[{ code: "ALL", slug: "all", name: "All countries", flag: "🌍" }, ...enabled.map((c) => ({ code: c.code, slug: c.code.toLowerCase(), name: c.name, flag: c.flag }))].map((c) => (
            <li key={c.code}>
              <Link
                href={withParams(`/dashboard/old-companies/${c.slug}`, { q: input.q, sort: input.sort }, {})}
                aria-current={c.code === code ? "page" : undefined}
                className={cn("inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium", c.code === code ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 bg-white text-ink-700 hover:bg-ink-50")}
              >
                <span aria-hidden>{c.flag}</span> {c.name}
                {c.code !== "ALL" && list.byCountry[c.code] !== undefined && code === "ALL" && <span className="rounded-full bg-ink-100 px-1.5 tabular-nums text-ink-600">{formatNumber(list.byCountry[c.code])}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <form method="get" action={basePath} className="flex flex-col gap-2 rounded-xl border border-ink-200 bg-white p-3 shadow-sm sm:flex-row sm:items-end">
        <label className="flex-1 text-xs font-medium text-ink-600">
          Search
          <input name="q" type="search" defaultValue={input.q ?? ""} placeholder="Company name, registration number or city" className="mt-1 block h-10 w-full rounded-lg border border-ink-200 px-3 text-sm text-ink-900 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20" />
        </label>
        <label className="text-xs font-medium text-ink-600">
          At least (years)
          <input name="minAge" type="number" min={list.config.minAgeYears} max={200} defaultValue={input.minAge ?? ""} placeholder={String(list.config.minAgeYears)} className="mt-1 block h-10 w-28 rounded-lg border border-ink-200 px-3 text-sm text-ink-900" />
        </label>
        <label className="text-xs font-medium text-ink-600">
          Sort
          <select name="sort" defaultValue={list.query.sort} className="mt-1 block h-10 rounded-lg border border-ink-200 bg-white px-3 text-sm text-ink-800">
            {OLD_COMPANY_SORTS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-10 rounded-lg bg-ink-900 px-4 text-sm font-medium text-white hover:bg-ink-800">
          Apply
        </button>
        {can(actor, "companies.export") && list.total > 0 && (
          <a href={exportHref} download className={buttonClasses("outline", "md", "h-10")}>
            <Download className="h-4 w-4" aria-hidden /> Export CSV
          </a>
        )}
      </form>

      {list.items.length === 0 ? (
        input.q || input.minAge ? (
          <EmptyState icon={SearchX} title="No established companies match these filters" description="Try another name, registration number or a lower minimum age." action={<ButtonLink href={basePath} variant="outline" size="sm">Clear filters</ButtonLink>} />
        ) : (
          <EmptyState
            icon={Building2}
            title="No verified established companies yet"
            description={
              collecting.length
                ? `Historical registry records are collected once a day per country (${collecting.map((c) => c.name).join(", ")}). Companies appear here after the next collection run — startup records are never used as a substitute.`
                : "No country with a verified historical registry source is enabled. Startup records are never used as a substitute."
            }
          />
        )
      ) : (
        <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm">
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <caption className="sr-only">Established companies</caption>
              <thead className="bg-ink-50 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                <tr>
                  <th scope="col" className="px-4 py-3">Company</th>
                  <th scope="col" className="px-4 py-3">Founded / registered</th>
                  <th scope="col" className="px-4 py-3">Registry status</th>
                  <th scope="col" className="px-4 py-3">Industry</th>
                  <th scope="col" className="px-4 py-3">Contact (as published)</th>
                  <th scope="col" className="px-4 py-3">Source</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((r) => {
                  const site = safeExternalUrl(r.website);
                  return (
                    <tr key={r.id} className="border-t border-ink-100 align-top">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-ink-900">{r.companyName}</p>
                        <p className="mt-0.5 text-xs text-ink-500">
                          <span className="mr-1 rounded bg-ink-100 px-1 font-medium text-ink-600">{r.countryCode}</span>
                          {r.registrationNumber}
                          {r.legalForm && ` · ${r.legalForm}`}
                          {r.city && ` · ${r.city}`}
                        </p>
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {r.foundedOn}
                        <p className="text-xs text-ink-500">{r.ageYears} years</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800 ring-1 ring-teal-200">{r.status}</span>
                        {r.employees !== undefined && <p className="mt-1 text-xs text-ink-500">{formatNumber(r.employees)} employees</p>}
                      </td>
                      <td className="px-4 py-3 text-ink-700">{r.industry ?? <span className="text-xs italic text-ink-400">Not published</span>}</td>
                      <td className="px-4 py-3 text-xs">
                        {site && (
                          <a href={site.href} target="_blank" rel="noopener noreferrer nofollow" className="block break-all font-medium text-brand-700 hover:underline">
                            {site.display}
                          </a>
                        )}
                        {r.email && <p className="break-all text-ink-700">{r.email}</p>}
                        {r.phone && <p className="tabular-nums text-ink-700">{r.phone}</p>}
                        {!site && !r.email && !r.phone && <span className="italic text-ink-400">Not published by the registry</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-600">
                        {r.sourceUrl ? (
                          <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
                            {r.sourceName ?? "Registry"} <ExternalLink className="h-3 w-3" aria-hidden />
                          </a>
                        ) : (
                          r.sourceName
                        )}
                        {r.verifiedAt && <p className="mt-0.5 text-ink-500">Checked {formatDateTime(r.verifiedAt)}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={list.page} pageCount={list.pageCount} total={list.total} buildHref={(p) => withParams(basePath, { q: input.q, sort: input.sort, minAge: input.minAge }, { page: p })} />
        </div>
      )}

      <section aria-label="Sources" className="rounded-xl border border-ink-200 bg-white p-4 text-sm shadow-sm">
        <h2 className="font-semibold text-ink-900">Historical registry sources</h2>
        <p className="mt-0.5 text-xs text-ink-500">Collected separately from the new-registration feeds of Startup Company Intelligence and stored in their own dataset.</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((c) => (
            <li key={c.code} className="rounded-lg border border-ink-100 px-3 py-2">
              <p className="font-medium text-ink-800">
                {COUNTRIES.find((x) => x.code === c.code)?.flag} {c.name} {c.provider && <span className="text-xs font-normal text-ink-500">({c.provider})</span>}
              </p>
              <p className={cn("mt-0.5 text-xs", c.collecting ? "text-teal-700" : "text-ink-500")}>
                {c.collecting ? `Collecting${c.lastRunAt ? ` · last run ${formatDateTime(c.lastRunAt)}` : " · not run yet"}${c.lastError ? ` · last error: ${c.lastError}` : ""}` : `Not collected — ${c.reason}`}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
