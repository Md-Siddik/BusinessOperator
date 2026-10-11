import { ServicesPage } from "@/components/workspace/services-page";

export const metadata = { title: "Services" };

/** Owner dashboard — shared with the staff workspace (/staff) via the same component. */
export default function Page() {
  return <ServicesPage base="/dashboard" />;
}
