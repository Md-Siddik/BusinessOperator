import { VerifyInquiry } from "@/components/site/verify-inquiry";
export const metadata = { title: "Verify inquiry email", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function Page({ searchParams }: { searchParams: Promise<{ id?: string; token?: string }> }) {
  const sp = await searchParams;
  return <VerifyInquiry id={sp.id || ""} token={sp.token || ""} />;
}
