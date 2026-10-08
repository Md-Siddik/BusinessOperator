import Link from "next/link";
import { Bell } from "lucide-react";
import { formatRelative } from "@/lib/utils/format";
import type { NotificationDoc } from "@/models";
import { EmptyState } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";

export function NotificationList({ items }: { items: NotificationDoc[] }) {
  if (!items.length) return <EmptyState icon={Bell} title="No notifications" description="You'll be notified about new client messages, requests, qualified leads, follow-ups and syncs." />;
  return (
    <ul className="divide-y divide-ink-100">
      {items.map((n) => {
        const content = (
          <>
            <p className="flex items-start gap-2 text-sm">
              {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />}
              <span className={cn(!n.readAt ? "font-semibold text-ink-900" : "text-ink-700")}>{n.title}</span>
            </p>
            {n.body && <p className="mt-0.5 text-sm text-ink-500">{n.body}</p>}
            <p className="mt-1 text-xs text-ink-400">
              {n.type.replace(/_/g, " ").toLowerCase()} · {formatRelative(n.updatedAt)}
            </p>
          </>
        );
        return (
          <li key={String(n._id)} className={cn(!n.readAt && "bg-brand-50/30")}>
            {n.link ? (
              <Link href={n.link} className="block px-5 py-3 hover:bg-ink-50">
                {content}
              </Link>
            ) : (
              <div className="px-5 py-3">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
