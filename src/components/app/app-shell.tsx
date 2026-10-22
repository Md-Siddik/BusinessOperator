"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  BarChart3,
  Bookmark,
  Building,
  CalendarDays,
  Contact,
  DatabaseZap,
  Bell,
  Briefcase,
  Building2,
  ChevronDown,
  ChevronsLeft,
  ClipboardList,
  FileText,
  Folder,
  Globe2,
  Home,
  Inbox,
  KanbanSquare,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  Mail,
  MailOpen,
  Radar,
  Menu,
  MessageSquare,
  ScrollText,
  BadgeCheck,
  Activity,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  UserCircle,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Drawer } from "@/components/ui/overlay";
import { LogoMark } from "@/components/site/logo";
import { cn } from "@/lib/utils";
import { useLiveCounts } from "./live-counts";

export const NAV_ICONS: Record<string, LucideIcon> = {
  overview: LayoutDashboard,
  today: CalendarDays,
  globe: Globe2,
  sources: DatabaseZap,
  companies: Building,
  contacts: Contact,
  saved: Bookmark,
  leads: Users,
  pipeline: KanbanSquare,
  followups: ClipboardList,
  campaigns: Send,
  templates: FileText,
  queue: Inbox,
  history: Mail,
  email: Mail,
  mailbox: MailOpen,
  suppression: ShieldCheck,
  clients: Building2,
  messages: MessageSquare,
  services: Sparkles,
  projects: Folder,
  tickets: LifeBuoy,
  analytics: BarChart3,
  traffic: Activity,
  users: Users,
  notifications: Bell,
  audit: ScrollText,
  settings: Settings,
  profile: UserCircle,
  documents: Briefcase,
  radar: Radar,
  hiring: Briefcase,
  procurement: Landmark,
  verify: BadgeCheck,
  health: Activity,
};

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  badge?: "messages" | "notifications";
  match?: string;
  flag?: string;
  demo?: boolean;
  /** Small right-aligned hint, e.g. today's registrations ("37") or a status ("off"). */
  meta?: string;
  metaTitle?: string;
  prominent?: boolean;
  /** Highlight only on this exact path (not sub-paths). */
  exact?: boolean;
};
/**
 * A group can be collapsible (a dropdown in the sidebar). `defaultOpen` (default true) is its
 * state until the viewer toggles it; the viewer's choice is remembered per browser.
 */
export type NavGroup = { title?: string; items: NavItem[]; collapsible?: boolean; defaultOpen?: boolean; id?: string };

function isActive(item: NavItem, pathname: string) {
  const match = item.match ?? item.href.split("?")[0]!;
  return item.exact || match === "/dashboard" || match === "/portal" ? pathname === match : pathname === match || pathname.startsWith(`${match}/`);
}

const GROUP_STATE_KEY = "et_nav_group_state";

/**
 * Open/closed state the viewer chose per group (restored from localStorage after hydration).
 * Groups the viewer never touched follow their `defaultOpen`.
 */
function useGroupState(activeGroupIds: string[]) {
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(GROUP_STATE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, boolean>;
      // The group holding the current page is never restored as closed.
      for (const id of activeGroupIds) if (saved[id] === false) delete saved[id];
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore a per-viewer preference after hydration
      setChosen(saved);
    } catch {
      /* storage unavailable */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore once after hydration
  }, []);
  const choose = (id: string, open: boolean) =>
    setChosen((prev) => {
      const next = { ...prev, [id]: open };
      try {
        localStorage.setItem(GROUP_STATE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  return { chosen, choose };
}

function NavLinks({ groups, collapsed, onNavigate }: { groups: NavGroup[]; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const counts = useLiveCounts();
  const groupIdOf = (g: NavGroup, gi: number) => g.id ?? g.title ?? `group-${gi}`;
  const activeGroupIds = groups.filter((g) => g.items.some((i) => isActive(i, pathname))).map((g) => groupIdOf(g, groups.indexOf(g)));
  const { chosen, choose } = useGroupState(activeGroupIds);
  const isOpen = (g: NavGroup, id: string) => !g.collapsible || (chosen[id] ?? g.defaultOpen ?? true) || (chosen[id] === undefined && activeGroupIds.includes(id));
  // Navigating to a page inside a closed group reopens it, so the current page is never hidden.
  useEffect(() => {
    for (const [gi, g] of groups.entries()) {
      const id = groupIdOf(g, gi);
      if (activeGroupIds.includes(id) && !isOpen(g, id)) choose(id, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to navigation only, not to the toggle itself
  }, [pathname]);
  return (
    <nav className="scroll-thin flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Application">
      {groups.map((g, gi) => {
        const groupId = groupIdOf(g, gi);
        const listId = `nav-${groupId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
        // The icon-only sidebar always shows every item.
        const open = collapsed || isOpen(g, groupId);
        const toggle = (id: string) => choose(id, !open);
        return (
        <div key={groupId}>
          {g.title && !collapsed && (g.collapsible ? (
            <button
              type="button"
              onClick={() => toggle(groupId)}
              aria-expanded={open}
              aria-controls={listId}
              className="mb-1.5 flex w-full items-center justify-between gap-2 rounded-md px-3 py-0.5 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400 hover:text-ink-700"
            >
              <span className="truncate">{g.title}</span>
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-150", !open && "-rotate-90")} aria-hidden />
            </button>
          ) : (
            <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">{g.title}</p>
          ))}
          {open && (
          <ul id={listId} className="space-y-0.5">
            {g.items.map((item) => {
              const Icon = NAV_ICONS[item.icon] ?? LayoutDashboard;
              const active = isActive(item, pathname);
              const badge = item.badge ? counts[item.badge] : 0;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      active ? "bg-brand-50 font-medium text-brand-800" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
                      item.prominent && !active && "bg-ink-900 font-semibold text-white hover:bg-ink-800 hover:text-white",
                      item.prominent && active && "bg-brand-600 font-semibold text-white",
                      collapsed && "justify-center px-0",
                    )}
                  >
                    {item.flag ? (
                      <span className="w-4 text-center text-sm" aria-hidden>
                        {item.flag}
                      </span>
                    ) : (
                      <Icon className={cn("h-4 w-4 shrink-0", item.prominent ? "text-white" : active ? "text-brand-600" : "text-ink-400 group-hover:text-ink-600")} aria-hidden />
                    )}
                    {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                    {!collapsed && item.demo && <span className="rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800">DEMO</span>}
                    {!collapsed && item.meta && (
                      <span title={item.metaTitle} className={cn("text-[11px] tabular-nums", item.prominent ? "text-white/80" : "text-ink-400")}>
                        {item.meta}
                      </span>
                    )}
                    {badge > 0 && (
                      <span className={cn("min-w-5 rounded-full bg-brand-600 px-1.5 text-center text-[11px] font-semibold leading-5 text-white", collapsed && "absolute ml-6 -mt-5")} aria-label={`${badge} unread`}>
                        {badge > 99 ? "99+" : badge}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          )}
        </div>
        );
      })}
    </nav>
  );
}

/** Link back to the public website (home page). */
function WebsiteLink({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      title={collapsed ? "Back to website" : undefined}
      className={cn("flex items-center gap-2 border-t border-ink-100 px-5 py-3 text-xs text-ink-500 hover:text-ink-800", collapsed && "justify-center px-0")}
    >
      <Home className="h-4 w-4" aria-hidden />
      {!collapsed && "Back to website"}
    </Link>
  );
}

export function AppShell({ groups, brandLabel, homeHref, topbar, children }: { groups: NavGroup[]; brandLabel: string; homeHref: string; topbar: ReactNode; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore a per-viewer preference after hydration
      setCollapsed(localStorage.getItem("et_sidebar") === "collapsed");
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("et_sidebar", c ? "open" : "collapsed");
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  const brand = (
    <Link href={homeHref} className="flex items-center gap-2.5">
      <LogoMark className="h-7 w-7" />
      {!collapsed && (
        <span className="leading-tight">
          <span className="block text-sm font-semibold text-ink-900">ExploreTechify</span>
          <span className="block text-[11px] text-ink-500">{brandLabel}</span>
        </span>
      )}
    </Link>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className={cn("sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-ink-200 bg-white transition-[width] duration-200 lg:flex", collapsed ? "w-[4.25rem]" : "w-64")}>
        <div className={cn("flex h-16 items-center border-b border-ink-100 px-4", collapsed && "justify-center px-0")}>{brand}</div>
        <NavLinks groups={groups} collapsed={collapsed} />
        <WebsiteLink collapsed={collapsed} />
        <button type="button" onClick={toggle} className="flex items-center gap-2 border-t border-ink-100 px-5 py-3 text-xs text-ink-500 hover:text-ink-800" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <ChevronsLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} aria-hidden />
          {!collapsed && "Collapse"}
        </button>
      </aside>

      <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} label="Navigation">
        <div className="flex h-16 items-center border-b border-ink-100 px-4">{brand}</div>
        <NavLinks groups={groups} collapsed={false} onNavigate={() => setMobileOpen(false)} />
        <WebsiteLink collapsed={false} onNavigate={() => setMobileOpen(false)} />
      </Drawer>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-ink-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button type="button" className="rounded-lg p-2 text-ink-600 hover:bg-ink-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu className="h-5 w-5" />
          </button>
          {topbar}
        </header>
        <main id="main" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
