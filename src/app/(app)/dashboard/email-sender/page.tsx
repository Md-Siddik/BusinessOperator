import { Mail } from "lucide-react";
import { requireOwnerPage } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/utils/format";
import { getDefaultTemplate, getSenderStatus, listSentEmails, listTemplates, previewEmail, TEMPLATE_OPTIONS } from "@/features/email-sender/service";
import { ownerMetadata } from "@/features/opportunities/metadata";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader, Pagination } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";
import { EmailSender } from "@/components/email-sender/email-sender";

export const dynamic = "force-dynamic";
export const generateMetadata = ownerMetadata("Email Sender");

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  SENT: { label: "Accepted by provider", tone: "success" },
  SENDING: { label: "Sending", tone: "info" },
  FAILED: { label: "Failed", tone: "danger" },
};

/** Email Sender — OWNER ONLY (page guard here; API routes and the service check again). */
export default async function EmailSenderPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const actor = await requireOwnerPage();
  const page = Number((await searchParams).page) || 1;
  const status = getSenderStatus(actor);
  const initialPreview = await previewEmail(actor, { mode: "TEMPLATE" });
  const template = getDefaultTemplate(actor);
  const templates = await listTemplates(actor);
  // The reminder needs an earlier email to a company, so it is offered from Company Intelligence only.
  const options = TEMPLATE_OPTIONS.filter((o) => o.id !== "reminder");
  const history = await listSentEmails(actor, { page });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Owner only"
        title="Email Sender"
        description="Send a professional one-to-one email from ExploreTechify — the ready-made introduction or your own message. One recipient per email; opted-out addresses are blocked automatically."
      />
      <EmailSender status={JSON.parse(JSON.stringify(status))} initialPreview={initialPreview} template={template} templates={templates} options={options} />

      <Card>
        <CardHeader
          title="Sent emails"
          description={`Accepted means the provider took the email for delivery — final delivery is not tracked. Message bodies are not stored. Limits: ${status.limits.hourly}/hour, ${status.limits.daily}/day, ${status.limits.cooldownMinutes} min between emails to the same address.`}
        />
        {history.items.length ? (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-ink-50 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-2.5">Recipient</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Subject</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Sent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {history.items.map((m) => {
                  const s = STATUS[m.status] ?? { label: m.status, tone: "neutral" as BadgeTone };
                  return (
                    <tr key={String(m._id)}>
                      <td className="px-5 py-2.5 font-medium text-ink-900">{m.to}</td>
                      <td className="px-4 py-2.5 text-ink-600">
                        {m.mode === "CUSTOM" ? "Custom" : m.outreachStep === "REMINDER" ? "Reminder" : "Template"}
                        {m.locale === "no" && <span className="ml-1.5 text-xs text-ink-400">NO</span>}
                      </td>
                      <td className="max-w-xs truncate px-4 py-2.5 text-ink-700" title={m.subject}>
                        {m.subject}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={s.tone} dot>
                          {s.label}
                        </Badge>
                        {m.error && <span className="mt-0.5 block text-xs text-red-700">{m.error}</span>}
                        {m.providerMessageId && <span className="mt-0.5 block font-mono text-[11px] text-ink-400">{m.provider} · {m.providerMessageId}</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-ink-600">{formatDateTime(m.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={Mail} title="No emails sent yet" description="Emails you send from this page are listed here with their provider status." />
        )}
        <Pagination page={history.page} pageCount={history.pageCount} total={history.total} buildHref={(p) => `/dashboard/email-sender?page=${p}`} />
      </Card>
    </div>
  );
}
