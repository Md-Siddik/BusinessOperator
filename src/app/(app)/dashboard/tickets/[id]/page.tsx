import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireInternalPage } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { getTicket } from "@/features/tickets/service";
import { listInternalUsers } from "@/features/crm/service";
import { PageHeader } from "@/components/ui/data";
import { TicketDetail } from "@/components/tickets/ticket-pages";

export const metadata = { title: "Ticket" };

export default async function DashboardTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireInternalPage();
  const { id } = await params;
  let ticket;
  try {
    ticket = await getTicket(actor, id);
  } catch {
    notFound();
  }
  const staff = await listInternalUsers();
  return (
    <div className="space-y-6">
      <Link href="/dashboard/tickets" className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Requests & tickets
      </Link>
      <PageHeader eyebrow={`${ticket.kind === "REQUEST" ? "Service request" : "Support ticket"} #${ticket.number}`} title={ticket.title} />
      <TicketDetail ticket={ticket as never} mode="internal" staff={staff.map((s) => ({ id: String(s._id), name: s.name }))} canAssign={can(actor, "tickets.manage")} />
    </div>
  );
}
