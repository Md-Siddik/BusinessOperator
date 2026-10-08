import { requireClientPage } from "@/lib/auth/session";
import { PortalTicketNew } from "@/components/tickets/portal-ticket-pages";

export const metadata = { title: "New" };

export default async function Page() {
  await requireClientPage();
  return <PortalTicketNew kind="REQUEST" />;
}
