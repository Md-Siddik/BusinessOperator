import { TicketsPage } from "@/components/workspace/tickets-page";

export const metadata = { title: "Requests & tickets" };

/** Staff workspace — same component as the owner dashboard, staff guard and links. */
export default function Page(props: { searchParams: Promise<{ kind?: string; status?: string; organizationId?: string; page?: string }> }) {
  return <TicketsPage base="/staff" searchParams={props.searchParams} />;
}
