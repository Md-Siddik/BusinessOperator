import { redirect } from "next/navigation";
import { requireInternalPage } from "@/lib/auth/session";
import { can } from "@/lib/permissions";

/** The first screen after login is today's new company registrations. */
export default async function DashboardHome({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const actor = await requireInternalPage();
  const { denied } = await searchParams;
  const suffix = denied ? "?denied=1" : "";
  redirect(can(actor, "companies.read") ? `/dashboard/today${suffix}` : `/dashboard/overview${suffix}`);
}
