import type { ReactNode } from "react";
import { AppShell, type NavGroup } from "@/components/app/app-shell";
import { LiveCountsProvider } from "@/components/app/live-counts";
import { NotificationBell, UserMenu } from "@/components/app/topbar-widgets";
import { requireClientPage } from "@/lib/auth/session";
import { Organization } from "@/models";
import { unreadConversationCount } from "@/features/chat/service";
import { unreadNotificationCount } from "@/features/notifications/service";
import { ChatWidget } from "@/components/chat/chat-widget";
import { isPreviewOrganization } from "@/lib/auth/preview";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const actor = await requireClientPage();
  const [org, messages, notifications] = await Promise.all([
    Organization.findById(actor.organizationId).select("name").lean<{ name: string }>(),
    unreadConversationCount(actor),
    unreadNotificationCount(actor.id),
  ]);
  const groups: NavGroup[] = [
    { items: [{ href: "/portal", label: "Overview", icon: "overview" }] },
    {
      title: "Workspace",
      collapsible: true,
      items: [
        { href: "/portal/messages", label: "Messages", icon: "messages", badge: "messages" },
        { href: "/portal/inquiries", label: "My Inquiries", icon: "queue" },
        { href: "/portal/requests", label: "Requests", icon: "queue" },
        { href: "/portal/tickets", label: "Support tickets", icon: "tickets" },
        { href: "/portal/projects", label: "Projects", icon: "projects" },
        { href: "/portal/services", label: "Services", icon: "services" },
        { href: "/portal/documents", label: "Documents", icon: "documents" },
      ],
    },
    {
      title: "Account",
      collapsible: true,
      items: [
        { href: "/portal/notifications", label: "Notifications", icon: "notifications", badge: "notifications" },
        { href: "/portal/profile", label: "Company & profile", icon: "profile" },
      ],
    },
  ];
  const topbar = (
    <div className="flex flex-1 items-center justify-between gap-3">
      <p className="truncate text-sm font-medium text-ink-700">{isPreviewOrganization(actor.organizationId) ? "Client organization (preview)" : org?.name}</p>
      <div className="flex items-center gap-1">
        <NotificationBell allHref="/portal/notifications" />
        <UserMenu name={actor.name} email={actor.email} role="client" profileHref="/portal/profile" />
      </div>
    </div>
  );
  return (
    <LiveCountsProvider initial={{ messages, notifications }}>
      <AppShell groups={groups} brandLabel="Client workspace" homeHref="/portal" topbar={topbar}>
        <>
          {children}
          <ChatWidget />
        </>
      </AppShell>
    </LiveCountsProvider>
  );
}
