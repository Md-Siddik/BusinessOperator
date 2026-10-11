import { ClientDetailPage } from "@/components/workspace/client-detail-page";

export const metadata = { title: "Client" };

/** Staff workspace — same component as the owner dashboard, staff guard and links. */
export default function Page(props: { params: Promise<{ id: string }> }) {
  return <ClientDetailPage base="/staff" params={props.params} />;
}
