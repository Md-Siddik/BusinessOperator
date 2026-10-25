import { AcceptInvitation } from "@/components/site/accept-invitation";
export const metadata = { title: "Accept invitation", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  return <AcceptInvitation token={(await searchParams).token || ""} />;
}
