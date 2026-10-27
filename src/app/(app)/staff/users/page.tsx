import { redirect } from "next/navigation";
import { requireTeamPage } from "@/lib/auth/session";
import { ACCESS_MANAGER_PERMISSIONS, accountAbilities, canOpenAccessManager, listAccess } from "@/features/access/service";
import { PageHeader } from "@/components/ui/data";
import { AccessManager } from "@/components/app/access-manager";
import { AccessPolicyNote } from "@/components/app/access-policy-note";

export const metadata = { title: "Users & access" };

/**
 * Permission Management for a Super Admin: only the people and permissions their Owner-granted,
 * scoped authorities cover (staff accounts, Opportunity Intelligence access, marketer lead access).
 */
export default async function Page() {
  const actor = await requireTeamPage(ACCESS_MANAGER_PERMISSIONS);
  if (!canOpenAccessManager(actor)) redirect("/staff?denied=1");
  const users = await listAccess(actor);
  return (
    <div className="space-y-6">
      <PageHeader title="Users & access" description="You can change only the permissions the Owner has allowed you to manage. Owner grants can only be removed by the Owner." />
      <AccessPolicyNote delegate />
      <AccessManager initialUsers={JSON.parse(JSON.stringify(users))} viewerRole={actor.role} abilities={accountAbilities(actor)} />
    </div>
  );
}
