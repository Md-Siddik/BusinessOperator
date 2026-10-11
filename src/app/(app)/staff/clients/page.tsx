import { ClientsPage } from "@/components/workspace/clients-page";

export const metadata = { title: "Clients" };

/** Staff workspace — same component as the owner dashboard, staff guard and links. */
export default function Page(props: { searchParams: Promise<{ tab?: string; status?: string; q?: string; page?: string }> }) {
  return <ClientsPage base="/staff" searchParams={props.searchParams} />;
}
