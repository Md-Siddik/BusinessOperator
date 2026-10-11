import { MessagesPage } from "@/components/workspace/messages-page";

export const metadata = { title: "Messages" };

/** Owner dashboard — shared with the staff workspace (/staff) via the same component. */
export default function Page() {
  return <MessagesPage base="/dashboard" />;
}
