"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatRelative } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { useLiveCounts } from "./live-counts";
import { markNotificationRead } from "./notification-read";

export type NotificationItemView = { id: string; title: string; body?: string; link?: string; type: string; read: boolean; updatedAt: string };

/** Notification center rows: opening an unread notification marks it read (indicator and count update at once). */
export function NotificationItems({ items }: { items: NotificationItemView[] }) {
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const { refresh } = useLiveCounts();
  const router = useRouter();
  const toast = useToast();

  async function open(n: NotificationItemView, navigates: boolean) {
    if (n.read || readIds.has(n.id)) return;
    setReadIds((s) => new Set(s).add(n.id));
    const ok = await markNotificationRead(n.id);
    if (!ok) {
      setReadIds((s) => {
        const next = new Set(s);
        next.delete(n.id);
        return next;
      });
      if (!navigates) toast.error("Couldn't mark the notification as read. Please try again.");
      return;
    }
    refresh();
    if (!navigates) router.refresh();
  }

  return (
    <ul className="divide-y divide-ink-100">
      {items.map((n) => {
        const unread = !n.read && !readIds.has(n.id);
        const content = (
          <>
            <p className="flex items-start gap-2 text-sm">
              {unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />}
              <span className={cn(unread ? "font-semibold text-ink-900" : "text-ink-700")}>{n.title}</span>
            </p>
            {n.body && <p className="mt-0.5 text-sm text-ink-500">{n.body}</p>}
            <p className="mt-1 text-xs text-ink-400">
              {n.type.replace(/_/g, " ").toLowerCase()} · {formatRelative(n.updatedAt)}
            </p>
          </>
        );
        return (
          <li key={n.id} className={cn(unread && "bg-brand-50/30")}>
            {n.link ? (
              <Link href={n.link} onClick={() => void open(n, true)} className="block px-5 py-3 hover:bg-ink-50">
                {content}
              </Link>
            ) : (
              <button type="button" onClick={() => void open(n, false)} className="block w-full px-5 py-3 text-left hover:bg-ink-50 focus-visible:bg-ink-50 focus-visible:outline-none">
                {content}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
