import { requireInternalPage } from "@/lib/auth/session";
import { listNotifications } from "@/features/notifications/service";
import { Card } from "@/components/ui/card";
import { PageHeader, Pagination } from "@/components/ui/data";
import { NotificationList } from "@/components/app/notification-list";
import { MarkAllReadButton } from "@/components/app/user-admin";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const actor = await requireInternalPage();
  const page = Number((await searchParams).page ?? 1) || 1;
  const result = await listNotifications(actor, { page, pageSize: 30 });
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Notification center" title="Notifications" description={`${result.unread} unread`} actions={<MarkAllReadButton />} />
      <Card>
        <NotificationList items={result.items} />
        <Pagination page={result.page} pageCount={result.pageCount} total={result.total} buildHref={(p) => `/dashboard/notifications?page=${p}`} />
      </Card>
    </div>
  );
}
