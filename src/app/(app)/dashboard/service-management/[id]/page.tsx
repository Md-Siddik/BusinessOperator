import { ServiceEditorPage } from "@/components/workspace/service-editor-page";

export const metadata = { title: "Edit service" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ServiceEditorPage base="/dashboard" id={(await params).id} />;
}
