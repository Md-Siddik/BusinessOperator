import Link from "next/link";
import { Contact as ContactIcon } from "lucide-react";
import { COUNTRIES } from "@/config/countries";
import { requireInternalPage } from "@/lib/auth/session";
import { CONTACT_SOURCE_KINDS, CONTACT_SOURCE_LABELS, formatPhone, type ContactSourceKind } from "@/lib/company-fields";
import { formatRelative } from "@/lib/utils/format";
import { listContacts } from "@/features/companies/contacts";
import { CONTACT_TYPES } from "@/models";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Pagination, withParams } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";
import { CopyButton, SourceTag } from "@/components/intel/contact-value";

export const metadata = { title: "Contacts" };

type SP = Record<string, string | undefined>;

export default async function ContactsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireInternalPage("companies.read");
  const sp = await searchParams;
  const result = await listContacts(actor, sp);
  const filterLink = (changes: SP) => withParams("/dashboard/contacts", sp, { ...changes, page: null });

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Research" title="Contacts" description="Every contact value on record, with where it came from. Registry values are the most authoritative; website and enrichment values are labelled as such." />

      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-ink-200 bg-white p-3" action="/dashboard/contacts">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-600">
          Country
          <select name="country" defaultValue={sp.country ?? "ALL"} className="h-9 rounded-lg border border-ink-200 px-2 text-sm">
            <option value="ALL">All countries</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-600">
          Type
          <select name="type" defaultValue={sp.type ?? ""} className="h-9 rounded-lg border border-ink-200 px-2 text-sm">
            <option value="">All types</option>
            {CONTACT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace("_", " ").toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-600">
          Source
          <select name="sourceKind" defaultValue={sp.sourceKind ?? ""} className="h-9 rounded-lg border border-ink-200 px-2 text-sm">
            <option value="">All sources</option>
            {CONTACT_SOURCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {CONTACT_SOURCE_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-600">
          Search value
          <input name="q" defaultValue={sp.q ?? ""} placeholder="e.g. @gmail.com or +47" className="h-9 rounded-lg border border-ink-200 px-2 text-sm" />
        </label>
        <button type="submit" className="h-9 rounded-lg bg-ink-900 px-3 text-sm font-medium text-white">
          Apply
        </button>
        {Object.values(sp).some(Boolean) && (
          <Link href="/dashboard/contacts" className="h-9 px-2 text-sm leading-9 text-ink-500 hover:text-ink-800">
            Clear
          </Link>
        )}
      </form>

      {result.items.length ? (
        <div className="scroll-thin overflow-x-auto rounded-xl border border-ink-200 bg-white">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-ink-50 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2.5">Value</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Company</th>
                <th className="px-4 py-2.5">Source</th>
                <th className="px-4 py-2.5">Verified</th>
                <th className="px-4 py-2.5">Recorded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {result.items.map((k) => (
                <tr key={String(k._id)}>
                  <td className="px-4 py-2.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="break-all font-medium text-ink-900">{k.type === "PHONE" || k.type === "MOBILE" ? formatPhone(k.value) : k.value}</span>
                      {k.type !== "CONTACT_PERSON" && <CopyButton value={k.value} label={k.type.toLowerCase()} />}
                    </span>
                    {k.role && <span className="text-xs text-ink-500">{k.role}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs uppercase tracking-wide text-ink-500">{k.type.replace("_", " ")}</td>
                  <td className="px-4 py-2.5">
                    {k.companyId ? (
                      <Link href={`/dashboard/companies/${k.companyId.countryCode.toLowerCase()}/${k.companyId._id}`} className="font-medium text-ink-900 hover:text-brand-700 hover:underline">
                        {k.companyId.companyName}
                      </Link>
                    ) : (
                      <span className="text-ink-400">Deleted company</span>
                    )}
                    <span className="block text-xs text-ink-500">{k.countryCode}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <Link href={filterLink({ sourceKind: k.sourceKind })} className="hover:underline">
                      <SourceTag kind={k.sourceKind as ContactSourceKind} />
                    </Link>
                    <span className="block text-xs text-ink-500">{k.source}</span>
                  </td>
                  <td className="px-4 py-2.5">{k.verified ? <Badge tone="success">{k.verificationMethod?.startsWith("MX") ? "MX" : "Yes"}</Badge> : <span className="text-xs text-ink-400">—</span>}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink-500">{formatRelative(k.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={ContactIcon} title="No contact values yet" description="Registry contact values are recorded during syncs; website values are added with “Find contact details” on a company profile." />
      )}
      <Pagination page={result.page} pageCount={result.pageCount} total={result.total} buildHref={(p) => withParams("/dashboard/contacts", sp, { page: p })} />
    </div>
  );
}
