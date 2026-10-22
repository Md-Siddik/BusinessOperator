import { MessagesPage, type MessagesSearchParams } from "@/components/workspace/messages-page";

export const metadata = { title: "Messages" };

/** Owner dashboard — shared with the staff workspace (/staff) via the same component. */
export default function Page({ searchParams }: { searchParams: MessagesSearchParams }) {
  return <MessagesPage base="/dashboard" searchParams={searchParams} />;
}
