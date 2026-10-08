import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireInternalPage } from "@/lib/auth/session";
import { toPlain } from "@/lib/utils";
import { getTemplate } from "@/features/outreach/service";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/data";
import { TemplateEditor } from "@/components/app/outreach-forms";

export const metadata = { title: "Template" };

export default async function TemplateEditPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireInternalPage("outreach.manage");
  const { id } = await params;
  let template;
  if (id !== "new") {
    try {
      template = toPlain(await getTemplate(actor, id));
    } catch {
      notFound();
    }
  }
  return (
    <div className="space-y-6">
      <Link href="/dashboard/outreach/templates" className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Templates
      </Link>
      <PageHeader eyebrow="Outreach" title={template ? template.name : "New template"} />
      <Card>
        <CardContent className="py-6">
          <TemplateEditor
            template={
              template
                ? { _id: String(template._id), name: template.name, subject: template.subject, body: template.body, countryCode: template.countryCode ?? "INTL", languageCode: template.languageCode ?? "en", industry: template.industry ?? undefined, serviceCategory: template.serviceCategory ?? undefined, active: template.active ?? true }
                : undefined
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
