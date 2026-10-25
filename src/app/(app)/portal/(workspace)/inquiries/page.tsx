import { InquiriesPage } from "@/components/workspace/inquiries-page";
export default function Page(props: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) { return <InquiriesPage base="/portal" {...props} />; }
