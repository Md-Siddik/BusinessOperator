import { requireClientPage } from "@/lib/auth/session";
import { PortalTicketList } from "@/components/tickets/portal-ticket-pages";

export const metadata = { title: "Tickets" };

export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const actor = await requireClientPage();
  return <PortalTicketList actor={actor} kind="TICKET" page={Number((await searchParams).page ?? 1) || 1} />;
}
