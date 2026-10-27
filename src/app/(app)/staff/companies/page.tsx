import { CompanyDirectoryPage } from "@/components/intel/company-directory-page";

export const metadata = { title: "Company Intelligence" };

export default function StaffCompaniesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <CompanyDirectoryPage searchParams={searchParams} />;
}
