import { LinkTabs } from "@/components/ui/data";

export function CrmTabs({ active, country }: { active: "leads" | "pipeline" | "follow-ups"; country: string }) {
  return (
    <LinkTabs
      active={active}
      tabs={[
        { id: "leads", label: "Leads", href: `/dashboard/crm?country=${country}` },
        { id: "pipeline", label: "Pipeline", href: `/dashboard/crm/pipeline?country=${country}` },
        { id: "follow-ups", label: "Follow-ups", href: `/dashboard/crm/follow-ups?country=${country}` },
      ]}
    />
  );
}

export function OutreachTabs({ active, country, pending }: { active: string; country: string; pending?: number }) {
  return (
    <LinkTabs
      active={active}
      tabs={[
        { id: "campaigns", label: "Campaigns", href: `/dashboard/outreach?country=${country}` },
        { id: "templates", label: "Templates", href: `/dashboard/outreach/templates?country=${country}` },
        { id: "queue", label: "Email Queue", href: `/dashboard/outreach/queue?country=${country}`, count: pending },
        { id: "history", label: "History", href: `/dashboard/outreach/history?country=${country}` },
        { id: "suppression", label: "Suppression list", href: `/dashboard/outreach/suppression` },
      ]}
    />
  );
}

export const SETTINGS_TABS = [
  { id: "general", label: "General" },
  { id: "countries", label: "Countries" },
  { id: "research", label: "Research" },
  { id: "packages", label: "Service packages" },
  { id: "languages", label: "Languages" },
  { id: "email", label: "Email" },
  { id: "crm", label: "CRM & scoring" },
  { id: "outreach", label: "Outreach" },
  { id: "chat", label: "Chat" },
  { id: "security", label: "Profile & security" },
] as const;

export function SettingsTabs({ active }: { active: string }) {
  return <LinkTabs active={active} tabs={SETTINGS_TABS.map((t) => ({ ...t, href: `/dashboard/settings/${t.id}` }))} />;
}
