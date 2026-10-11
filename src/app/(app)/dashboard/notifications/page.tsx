import { NotificationsPage } from "@/components/workspace/notifications-page";

export const metadata = { title: "Notifications" };

/** Owner dashboard — shared with the staff workspace (/staff) via the same component. */
export default function Page(props: { searchParams: Promise<{ page?: string }> }) {
  return <NotificationsPage base="/dashboard" searchParams={props.searchParams} />;
}
