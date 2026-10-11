import { ClientsPage } from "@/components/workspace/clients-page";

export const metadata = { title: "Clients" };

/** Owner dashboard — shared with the staff workspace (/staff) via the same component. */
export default function Page(props: { searchParams: Promise<{ tab?: string; status?: string; q?: string; page?: string }> }) {
  return <ClientsPage base="/dashboard" searchParams={props.searchParams} />;
}
