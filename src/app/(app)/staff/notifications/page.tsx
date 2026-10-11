import { NotificationsPage } from "@/components/workspace/notifications-page";

export const metadata = { title: "Notifications" };

/** Staff workspace — same component as the owner dashboard, staff guard and links. */
export default function Page(props: { searchParams: Promise<{ page?: string }> }) {
  return <NotificationsPage base="/staff" searchParams={props.searchParams} />;
}
