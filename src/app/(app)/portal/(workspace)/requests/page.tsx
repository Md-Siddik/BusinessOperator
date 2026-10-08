import { requireClientPage } from "@/lib/auth/session";
import { PortalTicketList } from "@/components/tickets/portal-ticket-pages";

export const metadata = { title: "Requests" };

export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const actor = await requireClientPage();
  return <PortalTicketList actor={actor} kind="REQUEST" page={Number((await searchParams).page ?? 1) || 1} />;
}
