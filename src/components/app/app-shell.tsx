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
  ChevronsLeft,
  ClipboardList,
  FileText,
  Folder,
  Globe2,
  Inbox,
  KanbanSquare,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  Mail,
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
  suppression: ShieldCheck,
  clients: Building2,
  messages: MessageSquare,
  services: Sparkles,
  projects: Folder,
  tickets: LifeBuoy,
  analytics: BarChart3,
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
export type NavGroup = { title?: string; items: NavItem[] };

function NavLinks({ groups, collapsed, onNavigate }: { groups: NavGroup[]; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const counts = useLiveCounts();
  return (
    <nav className="scroll-thin flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Application">
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.title && !collapsed && <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">{g.title}</p>}
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const Icon = NAV_ICONS[item.icon] ?? LayoutDashboard;
              const match = item.match ?? item.href.split("?")[0]!;
              const active = item.exact || match === "/dashboard" || match === "/portal" ? pathname === match : pathname === match || pathname.startsWith(`${match}/`);
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
        </div>
      ))}
    </nav>
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
        <button type="button" onClick={toggle} className="flex items-center gap-2 border-t border-ink-100 px-5 py-3 text-xs text-ink-500 hover:text-ink-800" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <ChevronsLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} aria-hidden />
          {!collapsed && "Collapse"}
        </button>
      </aside>

      <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} label="Navigation">
        <div className="flex h-16 items-center border-b border-ink-100 px-4">{brand}</div>
        <NavLinks groups={groups} collapsed={false} onNavigate={() => setMobileOpen(false)} />
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
