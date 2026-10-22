import { MessagesPage, type MessagesSearchParams } from "@/components/workspace/messages-page";

export const metadata = { title: "Messages" };

/** Staff workspace — same component as the owner dashboard, staff guard and links. */
export default function Page({ searchParams }: { searchParams: MessagesSearchParams }) {
  return <MessagesPage base="/staff" searchParams={searchParams} />;
}
