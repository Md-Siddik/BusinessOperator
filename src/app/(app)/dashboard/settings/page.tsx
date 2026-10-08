import { redirect } from "next/navigation";
import { requireInternalPage } from "@/lib/auth/session";
import { can } from "@/lib/permissions";

export default async function SettingsIndex() {
  const actor = await requireInternalPage();
  redirect(can(actor, "settings.manage") ? "/dashboard/settings/general" : can(actor, "content.manage") ? "/dashboard/settings/languages" : "/dashboard/settings/security");
}
