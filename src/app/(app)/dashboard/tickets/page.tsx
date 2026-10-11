import { TicketsPage } from "@/components/workspace/tickets-page";

export const metadata = { title: "Requests & tickets" };

/** Owner dashboard — shared with the staff workspace (/staff) via the same component. */
export default function Page(props: { searchParams: Promise<{ kind?: string; status?: string; organizationId?: string; page?: string }> }) {
  return <TicketsPage base="/dashboard" searchParams={props.searchParams} />;
}
