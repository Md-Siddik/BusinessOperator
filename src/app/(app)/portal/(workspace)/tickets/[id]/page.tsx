import { requireClientPage } from "@/lib/auth/session";
import { PortalTicketDetail } from "@/components/tickets/portal-ticket-pages";

export const metadata = { title: "Details" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireClientPage();
  return <PortalTicketDetail actor={actor} id={(await params).id} kind="TICKET" />;
}
