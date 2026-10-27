"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell, LogOut, UserCircle } from "lucide-react";
import { Dropdown, MenuItem } from "@/components/ui/overlay";
import { Avatar } from "@/components/ui/data";
import { Spinner } from "@/components/ui/spinner";
import { apiFetch } from "@/lib/api/client";
import { formatRelative } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { useLiveCounts } from "./live-counts";
import { markNotificationRead } from "./notification-read";

type NotificationItem = { _id: string; title: string; body?: string; link?: string; readAt?: string | null; updatedAt: string };

/** Notification center dropdown with live unread badge. */
export function NotificationBell({ allHref }: { allHref: string }) {
  const { notifications, refresh } = useLiveCounts();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  async function load() {
    setItems(null);
    const res = await apiFetch<{ items: NotificationItem[] }>("/api/notifications?pageSize=8");
    setItems(res.items);
  }
  /** Opening one notification marks only that notification read (the panel itself marks nothing). */
  async function openItem(n: NotificationItem) {
    if (n.readAt) return;
    const readAt = new Date().toISOString();
    setItems((list) => list?.map((x) => (x._id === n._id ? { ...x, readAt } : x)) ?? null);
    if (await markNotificationRead(n._id)) refresh();
    else setItems((list) => list?.map((x) => (x._id === n._id ? { ...x, readAt: null } : x)) ?? null);
  }
  async function markAll() {
    await apiFetch("/api/notifications", { body: {} });
    setItems((list) => list?.map((n) => ({ ...n, readAt: new Date().toISOString() })) ?? null);
  }
  return (
    <Dropdown
      label="Notifications"
      className="w-[22rem] max-w-[calc(100vw-2rem)] p-0"
      trigger={({ open, toggle, id }) => (
        <button
          type="button"
          onClick={() => {
            if (!open) void load();
            toggle();
          }}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={id}
          aria-label={`Notifications${notifications ? ` (${notifications} unread)` : ""}`}
          className="relative rounded-lg p-2 text-ink-600 hover:bg-ink-100 hover:text-ink-900"
        >
          <Bell className="h-5 w-5" />
          {notifications > 0 && <span className="absolute right-1 top-1 min-w-4 rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-4 text-white">{notifications > 9 ? "9+" : notifications}</span>}
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            <button type="button" onClick={markAll} className="text-xs font-medium text-brand-700 hover:text-brand-800">
              Mark all read
            </button>
          </div>
          <div className="scroll-thin max-h-96 overflow-y-auto">
            {items === null ? (
              <div className="flex justify-center py-8">
                <Spinner className="text-brand-600" />
              </div>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-500">You&apos;re all caught up.</p>
            ) : (
              items.map((n) => (
                <Link
                  key={n._id}
                  href={n.link ?? allHref}
                  onClick={() => {
                    void openItem(n);
                    close();
                  }}
                  role="menuitem" className={cn("block border-b border-ink-50 px-4 py-3 hover:bg-ink-50", !n.readAt && "bg-brand-50/40")}>
                  <p className="flex items-start gap-2 text-sm text-ink-900">
                    {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />}
                    <span className="font-medium">{n.title}</span>
                  </p>
                  {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-ink-500">{n.body}</p>}
                  <p className="mt-1 text-[11px] text-ink-400">{formatRelative(n.updatedAt)}</p>
                </Link>
              ))
            )}
          </div>
          <Link href={allHref} onClick={close} className="block px-4 py-2.5 text-center text-sm font-medium text-brand-700 hover:bg-ink-50">
            View all notifications
          </Link>
        </div>
      )}
    </Dropdown>
  );
}

export function UserMenu({ name, email, role, profileHref }: { name: string; email: string; role: string; profileHref: string }) {
  async function logout() {
    await apiFetch("/api/auth/logout", { body: {} }).catch(() => undefined);
    // Full reload on sign-out drops all client state and the realtime connection.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }
  return (
    <Dropdown
      label="Account"
      trigger={({ open, toggle, id }) => (
        <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-controls={id} className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-ink-100">
          <Avatar name={name} />
          <span className="hidden text-left leading-tight md:block">
            <span className="block text-sm font-medium text-ink-900">{name}</span>
            <span className="block text-[11px] capitalize text-ink-500">{role.toLowerCase()}</span>
          </span>
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="border-b border-ink-100 px-3 py-2">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate text-xs text-ink-500">{email}</p>
          </div>
          <MenuItem href={profileHref} onClick={close}>
            <UserCircle className="h-4 w-4" /> Profile & security
          </MenuItem>
          <MenuItem onClick={logout}>
            <LogOut className="h-4 w-4" /> Sign out
          </MenuItem>
        </>
      )}
    </Dropdown>
  );
}
