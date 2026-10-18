import { ServiceManagementPage } from "@/components/workspace/service-management-page";

export const metadata = { title: "Service management" };
export const dynamic = "force-dynamic";

/** Owner dashboard — shared with the staff workspace (/staff) via the same component. */
export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  return <ServiceManagementPage base="/dashboard" trash={(await searchParams).view === "trash"} />;
}
