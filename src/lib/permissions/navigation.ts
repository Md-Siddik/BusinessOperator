import { canAny, type Actor, type Permission } from "./index";

/**
 * Team-workspace (/staff) navigation. Every entry names the catalog permissions that unlock it
 * (any one is enough); entries without `requires` are personal (home, notifications, profile).
 * The same permissions guard the pages and APIs — hiding a link is never the only check.
 */
export type TeamNavItem = {
  href: string;
  label: string;
  icon: string;
  requires?: Permission[];
  exact?: boolean;
  match?: string;
  badge?: "messages" | "notifications";
};
export type TeamNavGroup = { id: string; title?: string; items: TeamNavItem[] };

export const TEAM_NAV: TeamNavGroup[] = [
  { id: "home", items: [{ href: "/staff", label: "Overview", icon: "overview", exact: true }] },
  {
    id: "marketing",
    title: "Marketing",
    items: [{ href: "/staff/client-leads", label: "Client leads", icon: "leads", requires: ["marketerLeads.view"] }],
  },
  {
    id: "opportunities",
    title: "Opportunity Intelligence",
    items: [{ href: "/staff/opportunities", label: "Opportunities", icon: "radar", requires: ["opportunities.view"] }],
  },
  {
    id: "clients",
    title: "Client data",
    items: [
      { href: "/staff/clients", label: "Clients", icon: "clients", requires: ["clients.manage"] },
      { href: "/staff/inquiries", label: "Client Inquiries", icon: "queue", requires: ["clients.manage"] },
      { href: "/staff/messages", label: "Messages", icon: "messages", badge: "messages", requires: ["chat.manage", "conversations.assigned"] },
      { href: "/staff/tickets", label: "Requests & tickets", icon: "tickets", requires: ["tickets.manage", "tickets.assigned"] },
      { href: "/staff/projects", label: "Projects", icon: "projects", requires: ["projects.manage", "projects.assigned"] },
      { href: "/staff/reports", label: "Reports", icon: "analytics", requires: ["analytics.view"] },
    ],
  },
  {
    id: "website",
    title: "Website",
    items: [
      { href: "/staff/services", label: "Services & case studies", icon: "services", exact: true, requires: ["content.manage", "services.manage"] },
      { href: "/staff/service-management", label: "Service management", icon: "templates", requires: ["services.manage"] },
      { href: "/staff/settings/general", match: "/staff/settings/general", label: "Website settings", icon: "settings", requires: ["content.manage"] },
      { href: "/staff/settings/languages", match: "/staff/settings/languages", label: "Languages & translations", icon: "globe", requires: ["content.manage"] },
    ],
  },
  {
    id: "team",
    title: "Team",
    items: [{ href: "/staff/users", label: "Users & access", icon: "users", requires: ["users.manage", "opportunities.grant", "marketerLeads.grant"] }],
  },
  {
    id: "account",
    title: "Account",
    items: [
      { href: "/staff/notifications", label: "Notifications", icon: "notifications", badge: "notifications" },
      { href: "/staff/settings/security", match: "/staff/settings/security", label: "Profile & security", icon: "profile" },
    ],
  },
];

/** The navigation this actor may see; empty groups are dropped. */
export function teamNavigation(actor: Actor): TeamNavGroup[] {
  return TEAM_NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.requires || canAny(actor, i.requires)) })).filter((g) => g.items.length > 0);
}

/** Can this actor use conversations at all (live chat widget, unread counts)? */
export function hasConversationAccess(actor: Actor) {
  return canAny(actor, ["chat.manage", "conversations.assigned"]);
}
