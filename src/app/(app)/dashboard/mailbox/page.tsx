import Link from "next/link";
import { MailOpen, Paperclip } from "lucide-react";
import { requireOwnerPage } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/utils/format";
import { AppError } from "@/lib/errors";
import { listMailbox, mailboxStatus } from "@/features/mailbox/service";
import { ownerMetadata } from "@/features/opportunities/metadata";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader, Pagination } from "@/components/ui/data";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { SenderBadge } from "@/components/mailbox/sender-badge";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const generateMetadata = ownerMetadata("Client Mail");

/** Client Mail — OWNER ONLY. The Zoho inbox (ZOHO_SMTP_USER), read live over IMAP. */
export default async function MailboxPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const actor = await requireOwnerPage();
  const page = Number((await searchParams).page) || 1;
  const status = mailboxStatus();

  let result: Awaited<ReturnType<typeof listMailbox>> | null = null;
  let error: string | null = null;
  if (status.configured) {
    try {
      result = await listMailbox(actor, { page });
    } catch (err) {
      error = err instanceof AppError ? err.message : "Could not read the mailbox right now. Try again shortly.";
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Owner only"
        title="Client Mail"
        description={`Emails received at ${status.address ?? "the Zoho mailbox"}. Read live from Zoho — nothing is copied or stored here. You are notified when a new email arrives.`}
      />
      {!status.configured && (
        <Alert tone="warning" title="Mailbox not connected">
          {status.problems.join(" ")} See docs/email-sender.md.
        </Alert>
      )}
      {error && (
        <Alert tone="danger" title="Could not load the mailbox">
          {error}
        </Alert>
      )}
      {result && (
        <Card>
          <CardHeader title="Inbox" description={`${result.total} email${result.total === 1 ? "" : "s"} · newest first`} />
          {result.items.length ? (
            <ul className="divide-y divide-ink-100">
              {result.items.map((m) => {
                return (
                  <li key={m.uid}>
                    <Link href={`/dashboard/mailbox/${m.uid}`} className={cn("flex flex-wrap items-start justify-between gap-3 px-5 py-3 hover:bg-ink-50", !m.seen && "bg-brand-50/30")}>
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-sm">
                          {!m.seen && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />}
                          <span className={cn(!m.seen ? "font-semibold text-ink-900" : "text-ink-700")}>{m.from?.name || m.from?.address || "Unknown sender"}</span>
                          {m.from?.name && <span className="text-xs text-ink-400">{m.from.address}</span>}
                          <SenderBadge sender={m.sender} />
                        </p>
                        <p className={cn("mt-0.5 truncate text-sm", !m.seen ? "font-medium text-ink-800" : "text-ink-600")}>
                          {m.hasAttachments && <Paperclip className="mr-1 inline h-3.5 w-3.5 text-ink-400" aria-label="Has attachments" />}
                          {m.subject}
                        </p>
                      </div>
                      <span className="whitespace-nowrap text-xs text-ink-500">{m.date ? formatDateTime(m.date) : ""}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon={MailOpen} title="Inbox is empty" description="Emails sent to this address appear here." />
          )}
          <Pagination page={result.page} pageCount={result.pageCount} total={result.total} buildHref={(p) => `/dashboard/mailbox?page=${p}`} />
        </Card>
      )}
    </div>
  );
}
