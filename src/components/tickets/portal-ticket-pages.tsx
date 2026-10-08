import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import type { Actor } from "@/lib/permissions";
import { getTicket, listTickets } from "@/features/tickets/service";
import { Card, CardContent } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader, Pagination } from "@/components/ui/data";
import { TicketDetail, TicketTable } from "./ticket-pages";
import { TicketCreateForm } from "./ticket-views";

const COPY = {
  REQUEST: { base: "/portal/requests", title: "Service requests", description: "Ask for website updates, new pages, SEO, recruitment, software, automation or social media work.", newLabel: "New request" },
  TICKET: { base: "/portal/tickets", title: "Support tickets", description: "Report a problem — something broken, not working or urgent.", newLabel: "New ticket" },
} as const;

export async function PortalTicketList({ actor, kind, page }: { actor: Actor; kind: "REQUEST" | "TICKET"; page: number }) {
  const copy = COPY[kind];
  const result = await listTickets(actor, { kind, page });
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title={copy.title}
        description={copy.description}
        actions={
          <ButtonLink href={`${copy.base}/new`} size="sm">
            <Plus className="h-4 w-4" aria-hidden /> {copy.newLabel}
          </ButtonLink>
        }
      />
      <Card>
        <TicketTable rows={result.items as never} hrefBase={(t) => `${copy.base}/${t._id}`} showClient={false} />
        <Pagination page={result.page} pageCount={result.pageCount} total={result.total} buildHref={(p) => `${copy.base}?page=${p}`} />
      </Card>
    </div>
  );
}

export function PortalTicketNew({ kind }: { kind: "REQUEST" | "TICKET" }) {
  const copy = COPY[kind];
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={copy.base} className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {copy.title}
      </Link>
      <PageHeader eyebrow="Workspace" title={copy.newLabel} description={copy.description} />
      <Card>
        <CardContent className="py-6">
          <TicketCreateForm kind={kind} mode="client" redirectBase={copy.base} />
        </CardContent>
      </Card>
    </div>
  );
}

export async function PortalTicketDetail({ actor, id, kind }: { actor: Actor; id: string; kind: "REQUEST" | "TICKET" }) {
  const copy = COPY[kind];
  let ticket;
  try {
    ticket = await getTicket(actor, id);
  } catch {
    notFound();
  }
  if (ticket.kind !== kind) notFound();
  return (
    <div className="space-y-6">
      <Link href={copy.base} className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {copy.title}
      </Link>
      <PageHeader eyebrow={`#${ticket.number}`} title={ticket.title} />
      <TicketDetail ticket={ticket as never} mode="client" />
    </div>
  );
}
