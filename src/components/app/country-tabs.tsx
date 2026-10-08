import { LinkTabs } from "@/components/ui/data";

export function CountryTabs({ slug, active }: { slug: string; active: "overview" | "browse" }) {
  return (
    <LinkTabs
      active={active}
      tabs={[
        { id: "overview", label: "Overview", href: `/dashboard/companies/${slug}` },
        { id: "browse", label: "Companies", href: `/dashboard/companies/${slug}/browse` },
      ]}
    />
  );
}
