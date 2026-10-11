import { SettingsIndexPage } from "@/components/workspace/settings-index-page";

/** Owner dashboard — shared with the staff workspace (/staff) via the same component. */
export default function Page() {
  return <SettingsIndexPage base="/dashboard" />;
}
