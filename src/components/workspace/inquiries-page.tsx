import Link from "next/link";
import { requireClientPage, requireWorkspacePage, type WorkspaceBase } from "@/lib/auth/session";
import { listInquiries, getInquiry, canManageInquiries } from "@/features/inquiries/service";
import { CONTACT_REQUEST_STATUSES } from "@/lib/constants";
import { PageHeader, Pagination, withParams } from "@/components/ui/data";
import { Card, CardContent } from "@/components/ui/card";
import { InquiryActions } from "./inquiry-actions";

type Base = WorkspaceBase | "/portal";
async function actorFor(base: Base) {
  return base === "/portal" ? requireClientPage() : requireWorkspacePage(base, "clients.manage");
}
export async function InquiriesPage({ base, searchParams }: { base: Base; searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const actor = await actorFor(base);
  const sp = await searchParams;
  const result = await listInquiries(actor, { ...sp, page: Number(sp.page) || 1 });
  return <div className="space-y-5">
    <PageHeader title={base === "/portal" ? "My Inquiries" : "Client Inquiries"} description={"Project requests and response history. New inquiries: " + result.unread} />
    <form className="flex flex-wrap gap-3">
      <input aria-label="Search inquiries" name="q" defaultValue={sp.q} placeholder="Search inquiries" className="rounded-lg border border-ink-200 p-2" />
      <select aria-label="Status" name="status" defaultValue={sp.status || ""} className="rounded-lg border border-ink-200 p-2"><option value="">All statuses</option>{CONTACT_REQUEST_STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</select>
      <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-white">Filter</button>
    </form>
    <Card><CardContent className="divide-y divide-ink-100 py-2">
      {!result.items.length && <p className="py-8 text-sm text-ink-500">No inquiries found.</p>}
      {result.items.map((r) => <Link key={String(r._id)} href={base + "/inquiries/" + r._id} className="block space-y-1 py-4 hover:text-brand-700">
        <p className="font-semibold">{r.name} · {r.need || "Project inquiry"}</p><p className="text-sm">{r.email} · {r.status.replaceAll("_", " ")} · {new Date(r.createdAt).toLocaleDateString("en-GB")}</p>
        <p className="truncate text-sm text-ink-500">{r.message}</p>
      </Link>)}
    </CardContent></Card>
    <Pagination page={result.page} pageCount={result.pageCount} total={result.total} buildHref={(page) => withParams(base + "/inquiries", sp, { page })} />
  </div>;
}
export async function InquiryDetailPage({ base, params }: { base: Base; params: Promise<{ id: string }> }) {
  const actor = await actorFor(base);
  const { id } = await params;
  const r = await getInquiry(actor, id);
  const manager = canManageInquiries(actor);
  const details = { "Client name": r.name, Email: r.email, Company: r.company, Phone: r.phone, Country: r.countryCode, Industry: r.industry, Website: r.website, "Project type": r.need, Budget: r.budget, Timeline: r.timeline, Engagement: r.engagement, "Preferred contact": r.preferredContact, "Ongoing support": r.ongoingSupport, "Interested services": r.interestedServices.join(", "), "Source page": r.serviceSlug, Locale: r.locale, "Client account": r.userId ? String(r.userId) : "Unlinked", "Submitted": new Date(r.createdAt).toLocaleString("en-GB"), "Email verified": r.emailVerifiedAt ? "Yes" : "Pending", ...(manager ? { "Internal notes": r.notes } : {}) };
  return <div className="space-y-5">
    <Link href={base + "/inquiries"} className="text-sm text-brand-700">Back to inquiries</Link>
    <PageHeader title={r.need || "Project inquiry"} description={r.status.replaceAll("_", " ")} />
    <Card><CardContent className="space-y-5 py-5">
      <dl className="grid gap-4 text-sm sm:grid-cols-2">{Object.entries(details).map(([label, value]) => <div key={label}><dt className="text-ink-500">{label}</dt><dd className="break-words font-medium">{value || "—"}</dd></div>)}</dl>
      <p className="whitespace-pre-wrap">{r.message}</p>
    </CardContent></Card>
    <Card><CardContent className="space-y-5 py-5">
      <h2 className="font-semibold">Conversation and quotations</h2>
      {!r.responses.length && <p className="text-sm text-ink-500">No responses yet.</p>}
      {r.responses.map((response) => <article key={String(response._id)} className="space-y-2 rounded-xl border border-ink-200 p-4 text-sm">
        <p className="font-semibold">{response.kind.replaceAll("_", " ")} · {response.createdAt ? new Date(response.createdAt).toLocaleString("en-GB") : ""}</p>
        <p className="whitespace-pre-wrap">{response.body}</p>
        {response.kind === "QUOTATION" && <div className="space-y-1"><p>{response.amount} {response.currency} · {response.decision}</p><p className="whitespace-pre-wrap">Scope: {response.scope}</p><p>Delivery: {response.delivery}</p><p className="whitespace-pre-wrap">Payment terms: {response.paymentTerms}</p><p className="whitespace-pre-wrap">{response.notes}</p></div>}
        {manager && response.kind !== "CLIENT_REPLY" && <p className="text-xs text-ink-500">Email: {response.emailStatus === "ACCEPTED" ? "Accepted by provider (delivery unconfirmed)" : response.emailStatus}</p>}
      </article>)}
      <InquiryActions id={id} manager={manager} verified={!!r.emailVerifiedAt} status={r.status} quotations={r.responses.filter((x) => x.kind === "QUOTATION").map((x) => ({ id: String(x._id), decision: x.decision || "PENDING" }))} />
    </CardContent></Card>
  </div>;
}
