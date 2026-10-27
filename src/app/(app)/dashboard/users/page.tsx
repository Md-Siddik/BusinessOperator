import { requireInternalPage } from "@/lib/auth/session";
import { accountAbilities, listAccess } from "@/features/access/service";
import { PageHeader } from "@/components/ui/data";
import { AccessManager } from "@/components/app/access-manager";
import { AccessPolicyNote } from "@/components/app/access-policy-note";

export const metadata = { title: "Users & access" };

/** Permission Management (Owner): every team account, what it can use, and who granted it. */
export default async function UsersPage() {
  const actor = await requireInternalPage("users.manage");
  const users = await listAccess(actor);
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Users & access"
        description="Choose a person to see exactly what they can use and turn individual permissions on or off. Everyone except the Owner starts with no access. Changes apply on their next click — no sign-out needed."
      />
      <AccessPolicyNote />
      <AccessManager initialUsers={JSON.parse(JSON.stringify(users))} viewerRole={actor.role} abilities={await accountAbilities(actor)} />
    </div>
  );
}
