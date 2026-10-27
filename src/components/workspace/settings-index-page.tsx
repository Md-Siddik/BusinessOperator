import { redirect } from "next/navigation";
import { requireTeamPage, requireWorkspacePage, type WorkspaceBase } from "@/lib/auth/session";
import { can } from "@/lib/permissions";

export async function SettingsIndexPage({ base }: { base: WorkspaceBase }): Promise<null> {
  const actor = base === "/staff" ? await requireTeamPage() : await requireWorkspacePage(base);
  redirect(can(actor, "settings.manage") ? `${base}/settings/general` : can(actor, "content.manage") ? `${base}/settings/languages` : `${base}/settings/security`);
}
