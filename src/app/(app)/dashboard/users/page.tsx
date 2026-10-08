import { requireInternalPage } from "@/lib/auth/session";
import { effectivePermissions, type Role } from "@/lib/permissions";
import { formatRelative } from "@/lib/utils/format";
import { listInternalUsersAdmin } from "@/features/users/service";
import { Card } from "@/components/ui/card";
import { Badge, DemoBadge, StatusBadge } from "@/components/ui/badge";
import { Avatar, PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui/data";
import { CreateUserButton, EditUserButton } from "@/components/app/user-admin";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const actor = await requireInternalPage("users.manage");
  const users = await listInternalUsersAdmin(actor);
  const isOwner = actor.role === "OWNER";
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Internal users"
        description="Owner manages admins; admins with users.manage can manage staff. Role or permission changes sign the user out of existing sessions. Client users are managed per client."
        actions={<CreateUserButton isOwner={isOwner} />}
      />
      <Card>
        <Table>
          <THead>
            <tr>
              <TH>User</TH>
              <TH>Role</TH>
              <TH>Status</TH>
              <TH>Permissions</TH>
              <TH>Last login</TH>
              <TH />
            </tr>
          </THead>
          <TBody>
            {users.items.map((u) => {
              const perms = effectivePermissions(u.role as Role, u.permissions);
              return (
                <TR key={String(u._id)}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <Avatar name={u.name} />
                      <div>
                        <p className="font-medium text-ink-900">
                          {u.name} {u.isDemo && <DemoBadge label="Demo" className="ml-1" />}
                        </p>
                        <p className="text-xs text-ink-500">{u.email}</p>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    <Badge tone={u.role === "OWNER" ? "violet" : u.role === "ADMIN" ? "brand" : "neutral"}>{u.role.toLowerCase()}</Badge>
                  </TD>
                  <TD>
                    <StatusBadge status={u.status} />
                  </TD>
                  <TD className="text-xs text-ink-500">{u.role === "OWNER" ? "All" : `${perms.length} permissions`}</TD>
                  <TD className="text-xs text-ink-500">{u.lastLoginAt ? formatRelative(u.lastLoginAt) : "Never"}</TD>
                  <TD className="text-right">
                    <EditUserButton user={{ id: String(u._id), name: u.name, role: u.role, status: u.status, permissions: perms }} isOwner={isOwner} isSelf={String(u._id) === actor.id} />
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
