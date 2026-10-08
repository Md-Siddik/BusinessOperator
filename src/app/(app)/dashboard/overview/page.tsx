import Link from "next/link";
import { ArrowRight, CalendarClock, Inbox, LifeBuoy, MessageSquare, UserPlus } from "lucide-react";
import { requireInternalPage } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { formatDay } from "@/lib/dates/country-time";
import { formatDate, formatNumber, formatRelative } from "@/lib/utils/format";
import { getOverview } from "@/features/analytics/service";
import { listCountryCards } from "@/features/companies/registrations";
import { listFollowUps } from "@/features/crm/service";
import { DATA_FRESHNESS_LABELS } from "@/features/registry/types";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/data";
import { ConnectionDot } from "@/components/intel/quality";
import { hasNoFeed, STATE_LABELS, type UiIntegrationState } from "@/lib/integration-state";

export const metadata = { title: "Overview" };

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const actor = await requireInternalPage();
  const sp = await searchParams;
  const canIntel = can(actor, "companies.read");
  const [cards, overview, overdue] = await Promise.all([
    canIntel ? listCountryCards(actor) : Promise.resolve([]),
    getOverview(actor, "ALL"),
    canIntel ? (listFollowUps(actor, { country: "ALL", bucket: "overdue", limit: 50 }) as unknown as Promise<unknown[]>) : Promise.resolve([]),
  ]);
  const todayTotal = cards.reduce((s, c) => s + (c.today ?? 0), 0);
  const connected = cards.filter((c) => c.today !== null).length;

  const attention = [
    { show: overview.waitingConversations > 0, icon: MessageSquare, text: `${overview.waitingConversations} client conversation${overview.waitingConversations === 1 ? "" : "s"} waiting for a reply`, href: "/dashboard/messages" },
    { show: overview.pendingApprovals > 0 && can(actor, "outreach.approve"), icon: Inbox, text: `${overview.pendingApprovals} outreach email${overview.pendingApprovals === 1 ? "" : "s"} awaiting approval`, href: "/dashboard/outreach/queue" },
    { show: overdue.length > 0, icon: CalendarClock, text: `${overdue.length} overdue follow-up${overdue.length === 1 ? "" : "s"}`, href: "/dashboard/crm/follow-ups?country=ALL" },
    { show: overview.pendingClients > 0, icon: UserPlus, text: `${overview.pendingClients} client signup${overview.pendingClients === 1 ? "" : "s"} awaiting approval`, href: "/dashboard/clients?status=PENDING_APPROVAL" },
    { show: overview.openTickets > 0, icon: LifeBuoy, text: `${overview.openTickets} open request${overview.openTickets === 1 ? "" : "s"} & tickets`, href: "/dashboard/tickets" },
  ].filter((a) => a.show);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={formatDate(new Date(), "EEEE d MMMM yyyy")} title={`Good to see you, ${actor.name.split(" ")[0]}`} description="New registrations per country first — then everything else that needs your attention." />
      {sp.denied && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900" role="alert">
          You don&apos;t have permission to open that page.
        </div>
      )}

      {canIntel && (
        <section aria-labelledby="countries-heading" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="countries-heading" className="text-lg font-semibold text-ink-900">
                New companies today
              </h2>
              <p className="text-sm text-ink-500">
                {connected ? `${formatNumber(todayTotal)} across ${connected} synced countr${connected === 1 ? "y" : "ies"} — each counted on its own local date.` : "No country has been synced today yet."}
              </p>
            </div>
            <Link href="/dashboard/today" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
              Open today&apos;s workspace <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map((c) => (
              <li key={c.code}>
                <Link href={`/dashboard/companies/${c.slug}`} className="block h-full rounded-2xl border border-ink-200 bg-white p-4 transition-shadow hover:shadow-soft">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-ink-900">
                      <span aria-hidden>{c.flag}</span> {c.name}
                    </span>
                    {c.isDemo && <span className="rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-900">DEMO</span>}
                  </div>
                  <p className="mt-3">
                    {c.today !== null ? (
                      <>
                        <span className="text-3xl font-semibold tabular-nums text-ink-900">{formatNumber(c.today)}</span> <span className="text-sm text-ink-500">today</span>
                      </>
                    ) : (
                      <span className="text-sm text-ink-500">{c.state === "NOT_SYNCED" ? "Today not synced yet" : STATE_LABELS[c.state as UiIntegrationState] ?? c.state}</span>
                    )}
                  </p>
                  <div className="mt-3 space-y-1 text-xs text-ink-500">
                    <ConnectionDot state={c.state} />
                    {c.freshness && !hasNoFeed(c.state) && (
                      <p>
                        {c.sourceName} · {DATA_FRESHNESS_LABELS[c.freshness]}
                      </p>
                    )}
                    <p>{c.lastSuccessAt ? `Last synced ${formatRelative(c.lastSuccessAt)}` : "Never synced"} · local date {formatDay(c.todayDay, { day: "numeric", month: "short" })}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Needs attention" />
          <CardContent>
            {attention.length ? (
              <ul className="space-y-2">
                {attention.map((a) => (
                  <li key={a.text}>
                    <Link href={a.href} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-ink-800 hover:bg-ink-50">
                      <a.icon className="h-4 w-4 text-ink-400" aria-hidden /> {a.text}
                      <ArrowRight className="ml-auto h-4 w-4 text-ink-300" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-500">Nothing urgent right now.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="Pipeline (last 30 days)" description="Secondary metrics — see Analytics for detail." />
          <CardContent>
            {overview.analytics ? (
              <dl className="grid grid-cols-3 gap-4 text-sm">
                {overview.analytics.funnel.slice(1).map((f) => (
                  <div key={f.stage}>
                    <dt className="text-xs text-ink-500">{f.stage}</dt>
                    <dd className="text-xl font-semibold tabular-nums text-ink-900">{formatNumber(f.count)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-ink-500">Analytics are not available for your role.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
