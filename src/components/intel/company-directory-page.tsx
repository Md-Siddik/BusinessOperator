import { requireTeamPage } from "@/lib/auth/session";
import { INDUSTRIES, INDUSTRY_LABELS } from "@/config/industries";
import { getEnabledCountries } from "@/features/countries/service";
import { DIRECTORY_SORT_LABELS, DIRECTORY_SORTS, listDirectory } from "@/features/companies/intel";
import { CompanyDirectory } from "./company-directory";

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * Company Intelligence for team members the Owner granted “View Company Intelligence”: startups
 * and established companies with business contacts. Checked here, in every API route and in the
 * service (edit / export / delete each need their own permission). Shared by All companies and
 * the Startup / Established sidebar categories (`fixedType` locks the category).
 */
export async function CompanyDirectoryPage({ searchParams, fixedType }: { searchParams: SP; fixedType?: "startup" | "established" }) {
  const actor = await requireTeamPage("companies.read");
  const sp = await searchParams;
  const params = Object.fromEntries(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"));
  if (fixedType) params.type = fixedType;
  const [initial, countries] = await Promise.all([listDirectory(actor, params).catch(() => listDirectory(actor, fixedType ? { type: fixedType } : {})), getEnabledCountries()]);
  return (
    <CompanyDirectory
      initial={JSON.parse(JSON.stringify(initial))}
      countries={countries.map((c) => ({ code: c.code, name: c.name, flag: c.flag }))}
      industries={INDUSTRIES.map((i) => ({ value: i, label: INDUSTRY_LABELS[i] }))}
      sorts={DIRECTORY_SORTS.map((s) => ({ value: s, label: DIRECTORY_SORT_LABELS[s] }))}
      fixedType={fixedType}
    />
  );
}
