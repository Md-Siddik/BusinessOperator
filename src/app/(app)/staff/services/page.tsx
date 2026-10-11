import { ServicesPage } from "@/components/workspace/services-page";

export const metadata = { title: "Services" };

/** Staff workspace — same component as the owner dashboard, staff guard and links. */
export default function Page() {
  return <ServicesPage base="/staff" />;
}
