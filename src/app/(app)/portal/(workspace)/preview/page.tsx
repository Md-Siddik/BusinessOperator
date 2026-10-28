import { notFound } from "next/navigation";
import { Eye } from "lucide-react";
import { requireClientPage, getSessionUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";

export const metadata = { title: "Client portal preview" };

/**
 * "View as Role" → Client. The proxy shows this page for every portal URL during a Client preview:
 * portal data always belongs to one client organization, so the preview shows the portal's
 * navigation and layout without opening any real client's records.
 */
export default async function PortalPreviewPage() {
  await requireClientPage();
  const user = await getSessionUser();
  if (user?.preview?.role !== "CLIENT") notFound();
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Preview" title="Client portal" description="This is the workspace a client signs in to." />
      <EmptyState
        icon={Eye}
        title="No client data in preview"
        description="Each client sees only their own organization's messages, requests, tickets, projects, services and documents. The preview shows the portal's navigation without opening any real client's records."
      />
    </div>
  );
}
