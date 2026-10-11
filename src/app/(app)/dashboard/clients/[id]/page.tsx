import { ClientDetailPage } from "@/components/workspace/client-detail-page";

export const metadata = { title: "Client" };

/** Owner dashboard — shared with the staff workspace (/staff) via the same component. */
export default function Page(props: { params: Promise<{ id: string }> }) {
  return <ClientDetailPage base="/dashboard" params={props.params} />;
}
