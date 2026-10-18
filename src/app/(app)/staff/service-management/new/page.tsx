import { ServiceEditorPage } from "@/components/workspace/service-editor-page";

export const metadata = { title: "Add service" };
export const dynamic = "force-dynamic";

export default function Page() {
  return <ServiceEditorPage base="/staff" />;
}
