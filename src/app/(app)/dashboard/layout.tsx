import type { ReactNode } from "react";
import { Suspense } from "react";
import { AppShell, type NavGroup } from "@/components/app/app-shell";
import { ChatWidget } from "@/components/chat/chat-widget";
import { CountrySwitcher } from "@/components/app/country-switcher";
import { GlobalSearch } from "@/components/app/global-search";
import { LiveCountsProvider } from "@/components/app/live-counts";
import { NotificationBell, UserMenu } from "@/components/app/topbar-widgets";
import { requireInternalPage } from "@/lib/auth/session";
import { isDemoModeEnabled } from "@/lib/data-mode";
import { navHint } from "@/lib/integration-state";
import { can, isOwner } from "@/lib/permissions";
import { listCountryCards } from "@/features/companies/registrations";
import { getEnabledCountries } from "@/features/countries/service";
import { unreadConversationCount } from "@/features/chat/service";
import { unreadNotificationCount } from "@/features/notifications/service";
import { resolveCountry } from "@/features/site/country-context";
import { opportunityNavCounts } from "@/features/opportunities/service";
import { Contact, InboxItem } from "@/models";

export const dynamic = "force-dynamic";

/**
 * Navigation hierarchy: Company Intelligence (today's registrations) first,
 * then research, CRM, outreach, clients, analytics, settings.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const actor = await requireInternalPage();
  const canIntel = can(actor, "companies.read");
  const [countries, ctx, messages, notifications, cards] = await Promise.all([
    getEnabledCountries(),
    resolveCountry(),
    unreadConversationCount(actor),
    unreadNotificationCount(actor.id),
    canIntel ? listCountryCards(actor) : Promise.resolve([]),
  ]);
  const q = `?country=${ctx.code}`;
  const [inboxUnread, reviewPending] = canIntel ? await Promise.all([InboxItem.countDocuments({ readAt: null, archivedAt: null }), Contact.countDocuments({ review: "PENDING" })]) : [0, 0];
  const cardByCode = new Map(cards.map((c) => [c.code, c]));
  const todayTotal = cards.reduce<number | null>((sum, c) => (c.today === null ? sum : (sum ?? 0) + c.today), null);

  // Owner-only module: rendered only for the OWNER role (pages and APIs enforce the same rule server-side).
  let opportunityGroup: NavGroup | null = null;
  if (isOwner(actor)) {
    const opp = await opportunityNavCounts(actor).catch(() => ({ review: 0, saved: 0 }));
    opportunityGroup = {
      title: "Opportunity Intelligence",
      collapsible: true,
      defaultOpen: false,
      items: [
        { href: "/dashboard/opportunities", label: "Opportunity overview", icon: "radar", exact: true },
        { href: "/dashboard/opportunities/hiring", label: "Hiring intelligence", icon: "hiring" },
        { href: "/dashboard/opportunities/procurement", label: "Service & projects", icon: "procurement" },
        { href: "/dashboard/opportunities/review", label: "Verification queue", icon: "verify", meta: opp.review ? String(opp.review) : undefined, metaTitle: "Opportunities awaiting manual review" },
        { href: "/dashboard/opportunities/saved", label: "Saved opportunities", icon: "saved", meta: opp.saved ? String(opp.saved) : undefined, metaTitle: "Saved opportunities" },
      ],
    };
  }

  const groups: NavGroup[] = [{ items: [{ href: "/dashboard/overview", label: "Overview", icon: "overview" }] }];
  if (canIntel) {
    groups.push({
      title: "Company Intelligence",
      collapsible: true,
      defaultOpen: false,
      items: [
        { href: "/dashboard/today", label: "Today", icon: "today", prominent: true, meta: todayTotal !== null ? String(todayTotal) : undefined, metaTitle: "New registrations today (connected countries)" },
        ...countries.map((c) => {
          const card = cardByCode.get(c.code);
          const hasCount = card?.today !== null && card?.today !== undefined;
          const hint = navHint(c.state);
          const meta = hasCount ? String(card!.today) : hint.meta;
          const metaTitle = hasCount ? "Registered today" : hint.title;
          return { href: `/dashboard/companies/${c.slug}`, label: c.name, icon: "globe", flag: c.flag, demo: c.isDemo, meta, metaTitle };
        }),
        { href: "/dashboard/companies/all", label: "All Countries", icon: "globe", flag: "🌍" },
        { href: "/dashboard/sources", label: "Data Sources", icon: "sources" },
      ],
    });
  }
  // Hiring intelligence (Opportunity Intelligence) directly follows Company Intelligence.
  if (opportunityGroup) groups.push(opportunityGroup);
  if (canIntel) {
    groups.push({
      title: "Research",
      collapsible: true,
      defaultOpen: false,
      items: [
        { href: "/dashboard/inbox", label: "Research inbox", icon: "queue", meta: inboxUnread ? String(inboxUnread) : undefined, metaTitle: "Unread inbox items" },
        { href: "/dashboard/review", label: "Review queue", icon: "suppression", meta: reviewPending ? String(reviewPending) : undefined, metaTitle: "Contacts waiting for review" },
        { href: "/dashboard/companies", label: "Companies", icon: "companies", exact: true },
        { href: "/dashboard/contacts", label: "Contacts", icon: "contacts" },
        { href: "/dashboard/leads", label: "Saved Leads", icon: "saved" },
        { href: "/dashboard/research", label: "Research ops", icon: "analytics" },
      ],
    });
    groups.push({
      title: "CRM",
      collapsible: true,
      defaultOpen: false,
      items: [
        { href: `/dashboard/crm${q}`, match: "/dashboard/crm", label: "Leads", icon: "leads" },
        { href: `/dashboard/crm/pipeline${q}`, label: "Pipeline", icon: "pipeline", match: "/dashboard/crm/pipeline" },
        { href: `/dashboard/crm/follow-ups${q}`, label: "Follow-ups", icon: "followups", match: "/dashboard/crm/follow-ups" },
        { href: "/dashboard/quotations", label: "Quotations", icon: "templates" },
        ...(can(actor, "analytics.view") ? [{ href: `/dashboard/analytics${q}`, match: "/dashboard/analytics", label: "Analytics", icon: "analytics" }] : []),
      ],
    });
  }
  if (can(actor, "outreach.manage")) {
    groups.push({
      title: "Outreach",
      collapsible: true,
      defaultOpen: false,
      items: [
        { href: `/dashboard/outreach${q}`, match: "/dashboard/outreach/campaigns", label: "Campaigns", icon: "campaigns" },
        { href: `/dashboard/outreach/queue${q}`, label: "Email Queue", icon: "queue", match: "/dashboard/outreach/queue" },
        { href: `/dashboard/outreach/templates${q}`, label: "Templates", icon: "templates", match: "/dashboard/outreach/templates" },
        { href: `/dashboard/outreach/history${q}`, label: "History", icon: "history", match: "/dashboard/outreach/history" },
        { href: "/dashboard/outreach/suppression", label: "Suppression", icon: "suppression" },
      ],
    });
  }
  groups.push({
    title: "Clients",
    collapsible: true,
    defaultOpen: false,
    items: [
      { href: "/dashboard/clients", label: "Clients", icon: "clients" },
      { href: "/dashboard/messages", label: "Messages", icon: "messages", badge: "messages" },
      { href: "/dashboard/projects", label: "Projects", icon: "projects" },
      { href: "/dashboard/tickets", label: "Tickets", icon: "tickets" },
      { href: "/dashboard/services", label: "Services", icon: "services" },
    ],
  });
  // Every titled group is a dropdown, closed until opened; the group holding the current page opens itself.
  const admin: NavGroup = { title: "Settings", collapsible: true, defaultOpen: false, items: [{ href: "/dashboard/settings", label: "Settings", icon: "settings" }] };
  if (can(actor, "users.manage")) admin.items.push({ href: "/dashboard/users", label: "Users", icon: "users" });
  if (can(actor, "audit.view")) admin.items.push({ href: "/dashboard/audit", label: "Audit Logs", icon: "audit" });
  groups.push(admin);

  const topbar = (
    <div className="flex flex-1 items-center justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {canIntel && <GlobalSearch />}
        <div className="hidden lg:block">
          <Suspense>
            <CountrySwitcher countries={countries.map((c) => ({ code: c.code, name: c.name, flag: c.flag, isLive: !c.isDemo }))} current={ctx.code} />
          </Suspense>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <NotificationBell allHref="/dashboard/notifications" />
        <UserMenu name={actor.name} email={actor.email} role={actor.role} profileHref="/dashboard/settings/security" />
      </div>
    </div>
  );

  return (
    <LiveCountsProvider initial={{ messages, notifications }}>
      <AppShell groups={groups} brandLabel="Company intelligence" homeHref="/dashboard/today" topbar={topbar}>
        {/* One fragment child: separate children passed into the client shell triggered React's "unique key" warning. */}
        <>
          {isDemoModeEnabled() && (
            <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="note">
              <span className="rounded-md bg-amber-400 px-2 py-0.5 text-xs font-bold tracking-wide text-amber-950">DEMO MODE</span>
              <span>Demo providers are enabled. Rows marked DEMO are fictional companies — not live registry data. Set DEMO_MODE=false to use real registries only.</span>
            </div>
          )}
          {children}
          {/* Live chat: answer client conversations from the message icon. */}
          <ChatWidget />
        </>
      </AppShell>
    </LiveCountsProvider>
  );
}
