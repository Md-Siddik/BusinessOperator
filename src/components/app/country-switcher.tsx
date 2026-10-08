"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Check } from "lucide-react";
import { Dropdown } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";

/** Persist the dashboard country context (non-sensitive UI preference). */
function rememberCountry(code: string) {
  document.cookie = `et_country=${code}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

export type CountryOption = { code: string; name: string; flag: string; isLive: boolean };

/** Persists the chosen country (cookie) and carries it across Overview, Companies, CRM, Outreach and Analytics. */
export function CountrySwitcher({ countries, current }: { countries: CountryOption[]; current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const active = countries.find((c) => c.code === current);

  function choose(code: string) {
    rememberCountry(code);
    const companyRoute = pathname.match(/^\/dashboard\/companies\/([a-z]{2,3})(\/browse)?/);
    if (companyRoute) {
      router.push(`/dashboard/companies/${code.toLowerCase()}${companyRoute[2] ?? ""}`);
      return;
    }
    const params = new URLSearchParams(search.toString());
    params.set("country", code);
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <Dropdown
      align="left"
      label="Country"
      trigger={({ open, toggle, id }) => (
        <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-controls={id} className="inline-flex h-9 items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 text-sm font-medium text-ink-800 shadow-soft hover:bg-ink-50">
          <span className="text-xs font-normal text-ink-500">Country</span>
          <span aria-hidden>{active?.flag ?? "🌍"}</span>
          {active?.name ?? "All Countries"}
          <ChevronDown className={cn("h-4 w-4 text-ink-400 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <>
          {countries.map((c) => (
            <button
              key={c.code}
              role="menuitem"
              type="button"
              onClick={() => {
                close();
                choose(c.code);
              }}
              className={cn("flex w-full items-center justify-between gap-6 rounded-lg px-3 py-2 text-left text-sm hover:bg-ink-50 focus:bg-ink-50 focus:outline-none", c.code === current ? "font-medium text-brand-700" : "text-ink-700")}
            >
              <span className="flex items-center gap-2">
                <span aria-hidden>{c.flag}</span>
                {c.name}
                {!c.isLive && <span className="rounded bg-amber-100 px-1.5 text-[10px] font-medium text-amber-800">DEMO</span>}
              </span>
              {c.code === current && <Check className="h-4 w-4" aria-hidden />}
            </button>
          ))}
          <div className="my-1 h-px bg-ink-100" />
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              close();
              choose("ALL");
            }}
            className={cn("flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-ink-50 focus:bg-ink-50 focus:outline-none", current === "ALL" ? "font-medium text-brand-700" : "text-ink-700")}
          >
            <span className="flex items-center gap-2">
              <span aria-hidden>🌍</span> All Countries
            </span>
            {current === "ALL" && <Check className="h-4 w-4" aria-hidden />}
          </button>
        </>
      )}
    </Dropdown>
  );
}
