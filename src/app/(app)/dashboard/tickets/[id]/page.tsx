import { TicketDetailPage } from "@/components/workspace/ticket-detail-page";

export const metadata = { title: "Ticket" };

/** Owner dashboard — shared with the staff workspace (/staff) via the same component. */
export default function Page(props: { params: Promise<{ id: string }> }) {
  return <TicketDetailPage base="/dashboard" params={props.params} />;
}
