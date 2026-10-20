import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { AppShell, type NavGroup } from "@/components/app/app-shell";
import { ChatWidget } from "@/components/chat/chat-widget";
import { LiveCountsProvider } from "@/components/app/live-counts";
import { NotificationBell, UserMenu } from "@/components/app/topbar-widgets";
import { requireStaffPage } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { unreadConversationCount } from "@/features/chat/service";
import { unreadNotificationCount } from "@/features/notifications/service";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Staff workspace", template: "%s · Staff workspace" } };

/**
 * Staff workspace (ADMIN / STAFF): client data and website maintenance only.
 * The owner dashboard (company intelligence, CRM, outreach, analytics, opportunities,
 * users, system settings) is never reachable from here — pages and APIs enforce it server-side.
 */
export default async function StaffLayout({ children }: { children: ReactNode }) {
  const actor = await requireStaffPage();
  const [messages, notifications] = await Promise.all([unreadConversationCount(actor), unreadNotificationCount(actor.id)]);

  const clientItems = [
    ...(can(actor, "clients.manage") ? [{ href: "/staff/clients", label: "Clients", icon: "clients" }] : []),
    { href: "/staff/messages", label: "Messages", icon: "messages", badge: "messages" as const },
    { href: "/staff/tickets", label: "Requests & tickets", icon: "tickets" },
    { href: "/staff/projects", label: "Projects", icon: "projects" },
  ];
  const websiteItems = [
    { href: "/staff/services", label: "Services & case studies", icon: "services", exact: true },
    ...(can(actor, "services.manage") ? [{ href: "/staff/service-management", label: "Service management", icon: "templates" }] : []),
    ...(can(actor, "content.manage") ? [{ href: "/staff/settings/general", match: "/staff/settings/general", label: "Website settings", icon: "settings" }, { href: "/staff/settings/languages", match: "/staff/settings/languages", label: "Languages & translations", icon: "globe" }] : []),
  ];
  const groups: NavGroup[] = [
    { items: [{ href: "/staff", label: "Overview", icon: "overview", exact: true }] },
    { title: "Client data", collapsible: true, items: clientItems },
    { title: "Website", collapsible: true, items: websiteItems },
    {
      title: "Account",
      collapsible: true,
      items: [
        { href: "/staff/notifications", label: "Notifications", icon: "notifications", badge: "notifications" },
        { href: "/staff/settings/security", match: "/staff/settings/security", label: "Profile & security", icon: "profile" },
      ],
    },
  ];

  const topbar = (
    <div className="flex flex-1 items-center justify-between gap-3">
      <p className="truncate text-sm font-medium text-ink-700">Staff workspace</p>
      <div className="flex items-center gap-1">
        <a href="/" target="_blank" rel="noopener" className="hidden items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-ink-600 hover:bg-ink-100 hover:text-ink-900 sm:inline-flex">
          View website <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
        <NotificationBell allHref="/staff/notifications" />
        <UserMenu name={actor.name} email={actor.email} role={actor.role} profileHref="/staff/settings/security" />
      </div>
    </div>
  );

  return (
    <LiveCountsProvider initial={{ messages, notifications }}>
      <AppShell groups={groups} brandLabel="Staff workspace" homeHref="/staff" topbar={topbar}>
        <>
          {children}
          {/* Live chat: answer client conversations from the message icon. */}
          <ChatWidget />
        </>
      </AppShell>
    </LiveCountsProvider>
  );
}
