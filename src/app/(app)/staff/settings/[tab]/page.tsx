import { SettingsTabPage } from "@/components/workspace/settings-tab-page";

export const metadata = { title: "Settings" };

/** Staff workspace — same component as the owner dashboard, staff guard and links. */
export default function Page(props: { params: Promise<{ tab: string }> }) {
  return <SettingsTabPage base="/staff" params={props.params} />;
}
