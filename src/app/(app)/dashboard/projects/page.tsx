import { ProjectsPage } from "@/components/workspace/projects-page";

export const metadata = { title: "Projects" };

/** Owner dashboard — shared with the staff workspace (/staff) via the same component. */
export default function Page(props: { searchParams: Promise<{ status?: string; organizationId?: string; page?: string }> }) {
  return <ProjectsPage base="/dashboard" searchParams={props.searchParams} />;
}
