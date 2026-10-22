import Link from "next/link";
import { ArrowLeft, Paperclip, Reply } from "lucide-react";
import { requireOwnerPage } from "@/lib/auth/session";
import { formatBytes, formatDateTime } from "@/lib/utils/format";
import { AppError } from "@/lib/errors";
import { getMail, type Address } from "@/features/mailbox/service";
import { ownerMetadata } from "@/features/opportunities/metadata";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { SenderBadge } from "@/components/mailbox/sender-badge";

export const dynamic = "force-dynamic";
export const generateMetadata = ownerMetadata("Client Mail");

const fmt = (a: Address) => (a.name ? `${a.name} <${a.address}>` : a.address);

/** One email from the Zoho inbox — OWNER ONLY. Opening it marks it read in Zoho. */
export default async function MailPage({ params }: { params: Promise<{ uid: string }> }) {
  const actor = await requireOwnerPage();
  const { uid } = await params;

  let mail: Awaited<ReturnType<typeof getMail>> | null = null;
  let error: string | null = null;
  try {
    mail = await getMail(actor, Number(uid));
  } catch (err) {
    error = err instanceof AppError ? err.message : "Could not read this email right now. Try again shortly.";
  }

  const back = (
    <Link href="/dashboard/mailbox" className="inline-flex items-center gap-1.5 text-sm text-brand-700 hover:underline">
      <ArrowLeft className="h-4 w-4" /> Client Mail
    </Link>
  );
  if (!mail) {
    return (
      <div className="space-y-4">
        {back}
        <Alert tone="danger" title="Could not open the email">
          {error}
        </Alert>
      </div>
    );
  }

  const replyTo = mail.replyTo ?? mail.from;
  const replyHref = replyTo ? `mailto:${replyTo.address}?subject=${encodeURIComponent(/^re:/i.test(mail.subject) ? mail.subject : `Re: ${mail.subject}`)}` : null;
  // Untrusted HTML: rendered in a sandboxed frame (no scripts, forms or same-origin access); links open in a new tab.
  const srcDoc = mail.html ? `<base target="_blank"><style>body{font-family:system-ui,sans-serif;font-size:14px;color:#1f2937;margin:16px;word-break:break-word}</style>${mail.html}` : null;

  return (
    <div className="space-y-4">
      {back}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
          <div className="min-w-0 space-y-1">
            <h1 className="text-lg font-semibold text-ink-900">{mail.subject}</h1>
            <p className="flex flex-wrap items-center gap-2 text-sm text-ink-700">
              <span className="font-medium">{mail.from ? fmt(mail.from) : "Unknown sender"}</span>
              <SenderBadge sender={mail.sender} linked />
            </p>
            {mail.to.length > 0 && <p className="text-xs text-ink-500">To: {mail.to.map(fmt).join(", ")}</p>}
            {mail.cc.length > 0 && <p className="text-xs text-ink-500">Cc: {mail.cc.map(fmt).join(", ")}</p>}
            {mail.date && <p className="text-xs text-ink-400">{formatDateTime(mail.date)}</p>}
          </div>
          {replyHref && (
            <a href={replyHref} className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-50">
              <Reply className="h-4 w-4" /> Reply
            </a>
          )}
        </div>
        {srcDoc ? (
          <iframe title="Email content" srcDoc={srcDoc} sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" className="h-[70vh] w-full rounded-b-2xl bg-white" />
        ) : (
          <pre className="whitespace-pre-wrap break-words px-5 py-4 font-sans text-sm text-ink-800">{mail.text || "(empty message)"}</pre>
        )}
        {mail.attachments.length > 0 && (
          <div className="border-t border-ink-100 px-5 py-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Attachments</p>
            <ul className="flex flex-wrap gap-2">
              {mail.attachments.map((a) => (
                <li key={a.index}>
                  <a href={`/api/mailbox/${mail.uid}/attachments/${a.index}`} className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50">
                    <Paperclip className="h-3.5 w-3.5" /> {a.filename} <span className="text-xs text-ink-400">{formatBytes(a.size)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
