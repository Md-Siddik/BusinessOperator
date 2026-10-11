import { ProjectDetailPage } from "@/components/workspace/project-detail-page";

export const metadata = { title: "Project" };

/** Staff workspace — same component as the owner dashboard, staff guard and links. */
export default function Page(props: { params: Promise<{ id: string }> }) {
  return <ProjectDetailPage base="/staff" params={props.params} />;
}
