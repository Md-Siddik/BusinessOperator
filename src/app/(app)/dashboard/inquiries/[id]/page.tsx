import { InquiryDetailPage } from "@/components/workspace/inquiries-page";
export default function Page(props: { params: Promise<{ id: string }> }) { return <InquiryDetailPage base="/dashboard" {...props} />; }
