import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { OPPORTUNITY_COUNTRIES } from "@/config/opportunity-countries";
import {
  ACTIVITY_LABELS,
  ACTIVITY_STATUSES,
  DATE_FIELD_LABELS,
  DATE_FIELDS,
  EMPLOYER_IDENTITY,
  EMPLOYER_IDENTITY_LABELS,
  REVIEW_STATUS_LABELS,
  REVIEW_STATUSES,
  SERVICE_CATEGORIES,
  SERVICE_CATEGORY_LABELS,
  SOURCE_CLASS_LABELS,
  SOURCE_CLASSES,
  VERIFICATION_LABEL_TEXT,
  VERIFICATION_LABELS,
  type OpportunityType,
} from "@/features/opportunities/constants";
import { buttonClasses } from "@/components/ui/button";

type Params = Record<string, string | undefined>;

const sel = "h-9 w-full rounded-lg border border-ink-200 bg-white px-2.5 text-sm text-ink-800 shadow-soft focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-100";
const lbl = "mb-1 block text-xs font-medium text-ink-600";

function Select({ name, label, value, options, all = "All" }: { name: string; label: string; value?: string; options: [string, string][]; all?: string | null }) {
  const id = `f-${name}`;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={lbl}>
        {label}
      </label>
      <select id={id} name={name} defaultValue={value ?? ""} className={sel}>
        {all !== null && <option value="">{all}</option>}
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

const yesNo: [string, string][] = [
  ["yes", "Yes"],
  ["no", "No"],
];

/**
 * Server-rendered GET filter form (works without JavaScript; URLs are shareable).
 * The date filter always names the timestamp it applies to.
 */
export function OpportunityFilters({ basePath, params, fixedType, dateDescription, hidden = {} }: { basePath: string; params: Params; fixedType?: OpportunityType; dateDescription?: string | null; hidden?: Params }) {
  const advancedOpen = ["source", "employer", "label", "category", "direct", "contact", "saved", "review", "linked", "company", "jobCategory", "archived", "provider"].some((k) => params[k]);
  return (
    <form method="get" action={basePath} className="space-y-3 rounded-2xl border border-ink-200 bg-white p-4 shadow-soft" aria-label="Filter opportunities">
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="col-span-2 min-w-0 sm:col-span-3 lg:col-span-2">
          <label htmlFor="f-q" className={lbl}>
            Keyword
          </label>
          <input id="f-q" name="q" type="search" defaultValue={params.q ?? ""} placeholder="Title, organization or description" className={sel} />
        </div>
        <Select name="country" label="Country" value={params.country} options={OPPORTUNITY_COUNTRIES.map((c) => [c.code, `${c.flag} ${c.name}`])} />
        {!fixedType && (
          <Select
            name="type"
            label="Type"
            value={params.type}
            options={[
              ["HIRING", "Hiring"],
              ["PROCUREMENT", "Service & project"],
            ]}
          />
        )}
        <Select
          name="activity"
          label="Activity"
          value={params.activity ?? "open"}
          all={null}
          options={[["open", "Open (active or unknown)"], ...ACTIVITY_STATUSES.map((a): [string, string] => [a, ACTIVITY_LABELS[a]]), ["all", "All"]]}
        />
        <Select
          name="sort"
          label="Sort by"
          value={params.sort ?? "discovered"}
          all={null}
          options={[
            ["discovered", "Newest discovered"],
            ["published", "Newest published"],
            ["deadline", "Deadline (soonest)"],
            ["checked", "Recently confirmed"],
          ]}
        />
      </div>

      <fieldset className="grid grid-cols-2 gap-3 border-t border-ink-100 pt-3 sm:grid-cols-4 lg:grid-cols-6">
        <legend className="sr-only">Date filter</legend>
        <div className="col-span-2 min-w-0">
          <Select name="dateField" label="Date applies to" value={params.dateField ?? "discovered"} all={null} options={DATE_FIELDS.map((f) => [f, DATE_FIELD_LABELS[f]])} />
        </div>
        <Select
          name="preset"
          label="Period"
          value={params.preset}
          all="Any time"
          options={[
            ["today", "Today"],
            ["7d", params.dateField === "deadline" ? "Next 7 days" : "Last 7 days"],
            ["30d", params.dateField === "deadline" ? "Next 30 days" : "Last 30 days"],
            ["custom", "Custom range"],
          ]}
        />
        <div className="min-w-0">
          <label htmlFor="f-from" className={lbl}>
            From
          </label>
          <input id="f-from" name="from" type="date" defaultValue={params.from ?? ""} className={sel} />
        </div>
        <div className="min-w-0">
          <label htmlFor="f-to" className={lbl}>
            To
          </label>
          <input id="f-to" name="to" type="date" defaultValue={params.to ?? ""} className={sel} />
        </div>
        <p className="col-span-2 self-end pb-2 text-xs text-ink-500 sm:col-span-4 lg:col-span-1">From/To apply when Period is “Custom range”.</p>
      </fieldset>

      <details className="group border-t border-ink-100 pt-3" open={advancedOpen}>
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-ink-700 hover:text-ink-900">
          <SlidersHorizontal className="h-4 w-4" aria-hidden /> More filters
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Select name="source" label="Source type" value={params.source} options={SOURCE_CLASSES.map((s) => [s, SOURCE_CLASS_LABELS[s]])} />
          <Select name="label" label="Verification" value={params.label} options={VERIFICATION_LABELS.map((l) => [l, VERIFICATION_LABEL_TEXT[l]])} />
          <Select name="employer" label="Employer identity" value={params.employer} options={EMPLOYER_IDENTITY.map((e) => [e, EMPLOYER_IDENTITY_LABELS[e]])} />
          <Select name="category" label="Service category" value={params.category} options={SERVICE_CATEGORIES.map((c) => [c, SERVICE_CATEGORY_LABELS[c]])} />
          <Select name="direct" label="Direct application / submission link" value={params.direct} options={yesNo} all="Any" />
          <Select name="contact" label="Contact information" value={params.contact} options={yesNo} all="Any" />
          <Select name="saved" label="Saved" value={params.saved} options={yesNo} all="Any" />
          <Select name="review" label="Review status" value={params.review} options={REVIEW_STATUSES.map((r) => [r, REVIEW_STATUS_LABELS[r]])} />
          <Select name="linked" label="Linked to a company record" value={params.linked} options={yesNo} all="Any" />
          <div className="min-w-0">
            <label htmlFor="f-company" className={lbl}>
              Company name
            </label>
            <input id="f-company" name="company" defaultValue={params.company ?? ""} className={sel} />
          </div>
          <div className="min-w-0">
            <label htmlFor="f-jobCategory" className={lbl}>
              Job / notice category
            </label>
            <input id="f-jobCategory" name="jobCategory" defaultValue={params.jobCategory ?? ""} className={sel} />
          </div>
          <Select
            name="archived"
            label="Archived"
            value={params.archived ?? "exclude"}
            all={null}
            options={[
              ["exclude", "Hide archived"],
              ["include", "Include archived"],
              ["only", "Archived only"],
            ]}
          />
        </div>
      </details>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-3">
        <p className="text-xs text-ink-500" aria-live="polite">
          {dateDescription ?? "No date filter. Default view hides closed, expired and archived opportunities."}
        </p>
        <div className="flex gap-2">
          <Link href={basePath} className={buttonClasses("ghost", "sm")}>
            Reset
          </Link>
          <button type="submit" className={buttonClasses("primary", "sm")}>
            Apply filters
          </button>
        </div>
      </div>
    </form>
  );
}
