import { ServiceManagementPage } from "@/components/workspace/service-management-page";

export const metadata = { title: "Service management" };
export const dynamic = "force-dynamic";

/** Staff workspace: Admin/Staff with the `services.manage` permission (checked by the page guard). */
export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  return <ServiceManagementPage base="/staff" trash={(await searchParams).view === "trash"} />;
}
