import { FileText } from "lucide-react";
import { requireClientPage } from "@/lib/auth/session";
import { formatBytes, formatDate, humanize } from "@/lib/utils/format";
import { listDocuments } from "@/features/clients/service";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";
import { DocumentUpload } from "@/components/app/client-admin";

export const metadata = { title: "Documents" };

export default async function PortalDocumentsPage() {
  const actor = await requireClientPage();
  const docs = await listDocuments(actor, actor.organizationId!);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Workspace" title="Documents" description="Proposals, contracts, brand assets, requirements and reports — private to your organization." />
      <Card>
        <CardHeader title={`${docs.length} documents`} action={<DocumentUpload orgId={actor.organizationId!} internal={false} />} />
        {docs.length === 0 ? (
          <EmptyState icon={FileText} title="No documents yet" description="Upload brand assets or requirements, and find proposals and reports from our team here." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Category</TH>
                <TH>Size</TH>
                <TH>Uploaded</TH>
              </tr>
            </THead>
            <TBody>
              {docs.map((d) => (
                <TR key={String(d._id)}>
                  <TD>
                    <a href={`/api/documents/${d._id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-medium text-ink-900 hover:text-brand-700">
                      <FileText className="h-4 w-4 text-ink-400" aria-hidden /> {d.name}
                    </a>
                  </TD>
                  <TD>{humanize(d.category)}</TD>
                  <TD className="tabular-nums text-ink-500">{d.size ? formatBytes(d.size) : "—"}</TD>
                  <TD className="text-xs text-ink-500">
                    {formatDate(d.createdAt)} · {(d.uploadedBy as unknown as { name?: string })?.name}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
