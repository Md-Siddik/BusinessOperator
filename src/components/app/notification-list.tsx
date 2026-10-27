import { Bell } from "lucide-react";
import type { NotificationDoc } from "@/models";
import { EmptyState } from "@/components/ui/feedback";
import { NotificationItems } from "./notification-items";

export function NotificationList({ items }: { items: NotificationDoc[] }) {
  if (!items.length) return <EmptyState icon={Bell} title="No notifications" description="You'll be notified about new client messages, client emails, requests, qualified leads and follow-ups." />;
  return (
    <NotificationItems
      items={items.map((n) => ({
        id: String(n._id),
        title: n.title,
        body: n.body ?? undefined,
        link: n.link ?? undefined,
        type: n.type,
        read: !!n.readAt,
        updatedAt: new Date(n.updatedAt).toISOString(),
      }))}
    />
  );
}
