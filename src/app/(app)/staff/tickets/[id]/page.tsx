import { TicketDetailPage } from "@/components/workspace/ticket-detail-page";

export const metadata = { title: "Ticket" };

/** Staff workspace — same component as the owner dashboard, staff guard and links. */
export default function Page(props: { params: Promise<{ id: string }> }) {
  return <TicketDetailPage base="/staff" params={props.params} />;
}
