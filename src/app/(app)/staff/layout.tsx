import type { ReactNode } from "react";
import { AppShell, type NavGroup } from "@/components/app/app-shell";
import { ChatWidget } from "@/components/chat/chat-widget";
import { LiveCountsProvider } from "@/components/app/live-counts";
import { NotificationBell, UserMenu } from "@/components/app/topbar-widgets";
import { requireTeamPage } from "@/lib/auth/session";
import { isDigitalMarketer, ROLE_LABELS } from "@/lib/permissions";
import { hasConversationAccess, teamNavigation } from "@/lib/permissions/navigation";
import { unreadConversationCount } from "@/features/chat/service";
import { unreadNotificationCount } from "@/features/notifications/service";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Team workspace", template: "%s · Team workspace" } };

/**
 * Team workspace (Super Admin, Staff, Digital Marketer). The navigation shows only what the
 * account has been granted (default deny); pages and APIs enforce the same permissions
 * server-side. The owner dashboard (Company Intelligence and Owner tools) is never reachable here.
 */
export default async function StaffLayout({ children }: { children: ReactNode }) {
  const actor = await requireTeamPage();
  const chat = hasConversationAccess(actor);
  const [messages, notifications] = await Promise.all([chat ? unreadConversationCount(actor) : Promise.resolve(0), unreadNotificationCount(actor.id)]);

  const groups: NavGroup[] = teamNavigation(actor).map((g) => ({
    id: g.id,
    title: g.title,
    collapsible: !!g.title,
    items: g.items.map((i) => ({ href: i.href, label: i.label, icon: i.icon, exact: i.exact, match: i.match, badge: i.badge })),
  }));
  const workspace = isDigitalMarketer(actor) ? "Marketing workspace" : "Team workspace";

  const topbar = (
    <div className="flex flex-1 items-center justify-between gap-3">
      <p className="truncate text-sm font-medium text-ink-700">{workspace}</p>
      <div className="flex items-center gap-1">
        <NotificationBell allHref="/staff/notifications" />
        <UserMenu name={actor.name} email={actor.email} role={ROLE_LABELS[actor.role]} profileHref="/staff/settings/security" />
      </div>
    </div>
  );

  return (
    <LiveCountsProvider initial={{ messages, notifications }}>
      <AppShell groups={groups} brandLabel={workspace} homeHref="/staff" topbar={topbar}>
        <>
          {children}
          {/* Live chat: answer client conversations from the message icon (only with conversation access). */}
          {chat && <ChatWidget />}
        </>
      </AppShell>
    </LiveCountsProvider>
  );
}
