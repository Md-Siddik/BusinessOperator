"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/dashboard/opportunities", label: "Overview", exact: true },
  { href: "/dashboard/opportunities/hiring", label: "Hiring" },
  { href: "/dashboard/opportunities/procurement", label: "Service & project" },
  { href: "/dashboard/opportunities/review", label: "Verification queue" },
  { href: "/dashboard/opportunities/saved", label: "Saved" },
  { href: "/dashboard/opportunities/notes", label: "Research notes" },
  { href: "/dashboard/opportunities/countries", label: "Countries" },
  { href: "/dashboard/opportunities/sources", label: "Sources & settings" },
  { href: "/dashboard/opportunities/health", label: "Sync health" },
];

export function OpportunityTabs() {
  const pathname = usePathname();
  return (
    <nav className="scroll-thin -mx-1 flex gap-1 overflow-x-auto border-b border-ink-200 px-1" aria-label="Opportunity intelligence sections">
      {TABS.map((t) => {
        const active = t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors", active ? "border-brand-600 text-brand-700" : "border-transparent text-ink-500 hover:text-ink-800")}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
