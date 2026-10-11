import { SettingsTabPage } from "@/components/workspace/settings-tab-page";

export const metadata = { title: "Settings" };

/** Owner dashboard — shared with the staff workspace (/staff) via the same component. */
export default function Page(props: { params: Promise<{ tab: string }> }) {
  return <SettingsTabPage base="/dashboard" params={props.params} />;
}
