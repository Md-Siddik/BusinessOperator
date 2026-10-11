import Link from "next/link";
import { ArrowRight, Building2, FolderKanban, Inbox, LifeBuoy, MessageSquare, UserPlus } from "lucide-react";
import type { ClientSummary } from "@/features/clients/summary";
import { countryName } from "@/config/countries";
import { formatDate, formatRelative } from "@/lib/utils/format";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";

/** Client details block — shared by the owner overview and the staff workspace home. */
export function ClientSummarySection({ summary, base }: { summary: ClientSummary; base: "/dashboard" | "/staff" }) {
  const c = summary.counts;
  const kpis = [
    c.activeClients !== null && { label: "Active clients", value: c.activeClients, icon: Building2, href: `${base}/clients?status=ACTIVE`, tone: "brand" as const },
    c.pendingClients !== null && { label: "Awaiting approval", value: c.pendingClients, icon: UserPlus, href: `${base}/clients?status=PENDING_APPROVAL`, tone: c.pendingClients ? ("warning" as const) : ("neutral" as const) },
    { label: "Messages awaiting reply", value: c.waitingConversations, icon: MessageSquare, href: `${base}/messages`, tone: c.waitingConversations ? ("warning" as const) : ("neutral" as const), hint: `${c.unreadConversations} with unread messages` },
    { label: "Open requests & tickets", value: c.openTickets, icon: LifeBuoy, href: `${base}/tickets`, tone: "neutral" as const },
    c.activeProjects !== null && { label: "Active projects", value: c.activeProjects, icon: FolderKanban, href: `${base}/projects?status=ACTIVE`, tone: "neutral" as const },
    c.newInquiries !== null && { label: "New website inquiries", value: c.newInquiries, icon: Inbox, href: `${base}/clients?tab=inquiries`, tone: c.newInquiries ? ("warning" as const) : ("neutral" as const) },
  ].filter(Boolean) as { label: string; value: number; icon: typeof Building2; href: string; tone: "brand" | "warning" | "neutral"; hint?: string }[];

  return (
    <section aria-labelledby="clients-heading" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="clients-heading" className="text-lg font-semibold text-ink-900">
            Clients
          </h2>
          <p className="text-sm text-ink-500">Client accounts, conversations and requests — counted from stored records.</p>
        </div>
        {summary.canSeeClients && (
          <Link href={`${base}/clients`} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
            All clients <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <KpiCard key={k.label} label={k.label} value={k.value} icon={k.icon} href={k.href} tone={k.tone} hint={k.hint} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {summary.canSeeClients && (
          <Card>
            <CardHeader title="Newest clients" description="Latest accounts with their primary contact." />
            {summary.recentClients.length ? (
              <div className="scroll-thin overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-ink-50 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                    <tr>
                      <th className="px-4 py-2.5">Client</th>
                      <th className="px-4 py-2.5">Contact</th>
                      <th className="px-4 py-2.5">Country</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5">Joined</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {summary.recentClients.map((r) => (
                      <tr key={r.id} className="hover:bg-ink-50/60">
                        <td className="px-4 py-2.5">
                          <Link href={`${base}/clients/${r.id}`} className="font-medium text-ink-900 hover:text-brand-700 hover:underline">
                            {r.name}
                          </Link>
                          {r.website && <span className="block truncate text-xs text-ink-500">{r.website.replace(/^https?:\/\//, "")}</span>}
                        </td>
                        <td className="px-4 py-2.5 text-ink-700">
                          {r.contact ? (
                            <>
                              {r.contact.name}
                              <a href={`mailto:${r.contact.email}`} className="block text-xs text-brand-700 hover:underline">
                                {r.contact.email}
                              </a>
                            </>
                          ) : r.email ? (
                            <a href={`mailto:${r.email}`} className="text-xs text-brand-700 hover:underline">
                              {r.email}
                            </a>
                          ) : (
                            "—"
                          )}
                          {r.phone && <span className="block text-xs text-ink-500">{r.phone}</span>}
                        </td>
                        <td className="px-4 py-2.5 text-ink-600">{r.countryCode ? countryName(r.countryCode) ?? r.countryCode : "—"}</td>
                        <td className="px-4 py-2.5">
                          <StatusBadge status={r.status} />
                        </td>
                        <td className="px-4 py-2.5 text-ink-600">{formatDate(r.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon={Building2} title="No clients yet" description="Client accounts appear here when someone signs up or you add one." />
            )}
          </Card>
        )}

        <Card className={summary.canSeeClients ? undefined : "xl:col-span-2"}>
          <CardHeader title="Latest conversations" description="Most recent client messages you can access." action={<Link href={`${base}/messages`} className="text-sm text-brand-700 hover:underline">Inbox</Link>} />
          {summary.latestConversations.length ? (
            <ul className="divide-y divide-ink-100">
              {summary.latestConversations.map((m) => (
                <li key={m.id}>
                  <Link href={`${base}/messages?c=${m.id}`} className="block px-5 py-3 hover:bg-ink-50/60">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-medium text-ink-900">{m.organization}</p>
                      <span className="shrink-0 text-xs text-ink-400">{formatRelative(m.lastMessageAt)}</span>
                    </div>
                    <p className="truncate text-sm text-ink-600">{m.subject}</p>
                    <div className="mt-1 flex items-center gap-2">
                      {m.waiting && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200">Awaiting reply</span>}
                      {m.preview && <span className="truncate text-xs text-ink-500">{m.preview}</span>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={MessageSquare} title="No conversations yet" description="Client messages from the website chat and the portal appear here in real time." />
          )}
        </Card>
      </div>
    </section>
  );
}
