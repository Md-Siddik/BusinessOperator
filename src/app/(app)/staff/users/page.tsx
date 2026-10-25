import { requireStaffPage } from "@/lib/auth/session";
import { listInternalUsersAdmin } from "@/features/users/service";
import { effectivePermissions, type Role } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/data";
import { CreateUserButton, EditUserButton } from "@/components/app/user-admin";
export default async function Page() {
  const actor = await requireStaffPage("users.manage");
  const result = await listInternalUsersAdmin(actor);
  return <div className="space-y-5"><PageHeader title="Staff management" description="Manage staff within approved permissions. Owner and Super Admin identities cannot be changed here." actions={<CreateUserButton isOwner={false} />} />
    <div className="divide-y rounded-xl border border-ink-200 bg-white px-5">{result.items.map((u) => <div key={String(u._id)} className="flex flex-wrap items-center justify-between gap-3 py-4">
      <div><p className="font-semibold">{u.name}</p><p className="text-sm text-ink-500">{u.email} · {u.status}</p></div>
      <EditUserButton user={{ id: String(u._id), name: u.name, role: u.role, status: u.status, permissions: effectivePermissions(u.role as Role, u.permissions) }} isOwner={false} isSelf={String(u._id) === actor.id} />
    </div>)}</div>
  </div>;
}
