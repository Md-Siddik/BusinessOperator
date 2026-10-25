import { requireStaffPage } from "@/lib/auth/session";
import { ContactRequest, Organization, User } from "@/models";
import { CONTACT_REQUEST_STATUSES } from "@/lib/constants";
import { PageHeader } from "@/components/ui/data";
export default async function Page() {
  await requireStaffPage("analytics.view");
  const [clients, pending, staff, statuses] = await Promise.all([
    Organization.countDocuments({ status: "ACTIVE" }), Organization.countDocuments({ status: "PENDING_APPROVAL" }),
    User.countDocuments({ role: "STAFF", status: "ACTIVE" }),
    Promise.all(CONTACT_REQUEST_STATUSES.map(async (status) => ({ status, count: await ContactRequest.countDocuments({ status }) }))),
  ]);
  return <div className="space-y-5"><PageHeader title="Administrative reports" description="Current client, staff, and inquiry totals." />
    <dl className="grid gap-4 sm:grid-cols-3">{Object.entries({ "Active clients": clients, "Pending clients": pending, "Active staff": staff }).map(([label,value]) => <div key={label} className="rounded-xl border border-ink-200 bg-white p-5"><dt>{label}</dt><dd className="text-2xl font-semibold">{value}</dd></div>)}</dl>
    <div className="rounded-xl border border-ink-200 bg-white p-5"><h2 className="font-semibold">Inquiries by status</h2>{statuses.map((row) => <p key={row.status} className="flex justify-between border-b border-ink-100 py-2 text-sm"><span>{row.status.replaceAll("_", " ")}</span><span>{row.count}</span></p>)}</div>
  </div>;
}
