import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireInternalPage } from "@/lib/auth/session";
import { getQuotation } from "@/features/quotations/service";
import { PageHeader } from "@/components/ui/data";
import { QuotationEditor } from "@/components/intel/quotation-editor";

export const metadata = { title: "Quotation" };

export default async function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireInternalPage("companies.read");
  const { id } = await params;
  let data;
  try {
    data = await getQuotation(actor, id);
  } catch {
    notFound();
  }
  const { quotation: q, company: c, recipients } = data;
  return (
    <div className="space-y-5">
      <Link href={`/dashboard/companies/${c.countryCode.toLowerCase()}/${c._id}`} className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {c.companyName}
      </Link>
      <PageHeader eyebrow={`Quotation #${q.number}`} title={q.title} description="Only confirmed company details and owner-approved prices. Missing values stay as placeholders until you fill them in. Nothing is sent from here." />
      <QuotationEditor
        id={String(q._id)}
        initial={{
          title: q.title,
          currency: q.currency,
          items: q.items.map((i) => ({ description: i.description ?? "", quantity: i.quantity ?? 1, unitPrice: i.unitPrice ?? null, unit: i.unit ?? "" })),
          deliverables: q.deliverables,
          timeline: q.timeline ?? "",
          terms: q.terms ?? "",
          notes: q.notes ?? "",
          status: q.status,
          recipientContactId: q.recipient?.contactId ? String(q.recipient.contactId) : "",
          validUntil: q.validUntil ? new Date(q.validUntil).toISOString().slice(0, 10) : "",
        }}
        recipients={recipients.map((r) => ({ id: String(r._id), label: `${r.type === "EMAIL" ? "Email" : "Phone"}: ${r.value}` }))}
        eligible={c.eligibility?.status === "CLEARED"}
      />
    </div>
  );
}
