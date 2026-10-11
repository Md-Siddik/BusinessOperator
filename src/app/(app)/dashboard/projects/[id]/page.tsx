import { ProjectDetailPage } from "@/components/workspace/project-detail-page";

export const metadata = { title: "Project" };

/** Owner dashboard — shared with the staff workspace (/staff) via the same component. */
export default function Page(props: { params: Promise<{ id: string }> }) {
  return <ProjectDetailPage base="/dashboard" params={props.params} />;
}
