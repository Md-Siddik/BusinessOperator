import { redirect } from "next/navigation";
import { requireInternalPage } from "@/lib/auth/session";

/** The first screen after login is the owner overview: clients, today's new companies, decisions. */
export default async function DashboardHome({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  await requireInternalPage();
  const { denied } = await searchParams;
  const suffix = denied ? "?denied=1" : "";
  redirect(`/dashboard/overview${suffix}`);
}
