import { ProjectsPage } from "@/components/workspace/projects-page";

export const metadata = { title: "Projects" };

/** Staff workspace — same component as the owner dashboard, staff guard and links. */
export default function Page(props: { searchParams: Promise<{ status?: string; organizationId?: string; page?: string }> }) {
  return <ProjectsPage base="/staff" searchParams={props.searchParams} />;
}
