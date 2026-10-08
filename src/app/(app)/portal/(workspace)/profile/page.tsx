import { requireClientPage } from "@/lib/auth/session";
import { Organization, User, type OrganizationDoc, type UserDoc } from "@/models";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/data";
import { OrganizationProfileForm } from "@/components/app/portal-forms";
import { SecurityForms } from "@/components/app/settings-forms";

export const metadata = { title: "Company & profile" };

export default async function PortalProfilePage() {
  const actor = await requireClientPage();
  const [org, me] = await Promise.all([Organization.findById(actor.organizationId).lean<OrganizationDoc>(), User.findById(actor.id).lean<UserDoc>()]);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Account" title="Company & profile" />
      <Card>
        <CardHeader title="Company profile" description="Shared with everyone in your organization." />
        <CardContent className="py-5">
          <OrganizationProfileForm org={{ id: String(org!._id), name: org!.name, website: org!.website ?? undefined, phone: org!.phone ?? undefined, address: org!.address ?? undefined, preferredLanguage: org!.preferredLanguage ?? "en" }} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader title="Your profile & security" />
        <CardContent className="py-5">
          <SecurityForms profile={{ name: me?.name ?? actor.name, phone: me?.phone ?? undefined, preferredLanguage: me?.preferredLanguage ?? "en", emailOnChatMessage: me?.notificationPrefs?.emailOnChatMessage !== false, emailOnTicketUpdate: me?.notificationPrefs?.emailOnTicketUpdate !== false }} />
        </CardContent>
      </Card>
    </div>
  );
}
