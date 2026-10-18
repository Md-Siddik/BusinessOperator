import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LANGUAGES } from "@/config/languages";
import { SERVICE_ITEM_KEYS } from "@/config/services";
import { requireWorkspacePage, type WorkspaceBase } from "@/lib/auth/session";
import { getBaseMessages } from "@/lib/i18n/dictionaries";
import { createTranslator } from "@/lib/i18n/translator";
import { CONTACT_NEEDS, SERVICE_ICONS } from "@/models";
import { getServiceAdmin, listServicesAdmin } from "@/features/service-catalog/service";
import { PageHeader } from "@/components/ui/data";
import { ServiceEditor, type ServiceRecord } from "@/components/app/service-editor";

/** Add / edit one service (Owner, and Admin/Staff with `services.manage`). */
export async function ServiceEditorPage({ base, id }: { base: WorkspaceBase; id?: string }) {
  const actor = await requireWorkspacePage(base, "services.manage");
  const { t } = createTranslator(getBaseMessages("en"));
  const [record, list] = await Promise.all([id ? getServiceAdmin(actor, id) : Promise.resolve(undefined), listServicesAdmin(actor)]);
  const options = {
    icons: SERVICE_ICONS,
    languages: LANGUAGES.map((l) => ({ code: l.code, name: l.englishName })),
    serviceItems: SERVICE_ITEM_KEYS.map((key) => ({ key, label: t(`serviceItems.${key}`) })),
    services: list.rows.map((r) => ({ slug: r.slug, name: r.name })),
    needs: CONTACT_NEEDS.map((key) => ({ key, label: t(`contact.form.needs.${key}`) })),
  };
  return (
    <div className="space-y-5">
      <Link href={`${base}/service-management`} className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Service management
      </Link>
      <PageHeader eyebrow="Service management" title={record ? record.name : "Add service"} description={record ? `exploretechify.com/services/${record.slug}` : "New services start inactive. Save, preview, then activate to publish."} />
      {/* Serialised for the client component (dates → ISO strings). */}
      <ServiceEditor base={base} initial={record ? (JSON.parse(JSON.stringify(record)) as ServiceRecord) : undefined} options={options} />
    </div>
  );
}
