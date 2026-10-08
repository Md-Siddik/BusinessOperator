"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Search } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { displayWebsite, formatPhone } from "@/lib/company-fields";
import { cn } from "@/lib/utils";

type Hit = { id: string; name: string; registrationNumber?: string; countryCode: string; registrationDay?: string; city?: string; email?: string; phone?: string; website?: string; isDemo?: boolean };

/** Company search across name, registration number, email, phone, website and address (server-side). */
export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const t = setTimeout(() => {
      apiFetch<{ items: Hit[] }>(`/api/search?q=${encodeURIComponent(term)}`)
        .then((r) => {
          setHits(r.items);
          setActive(0);
          setOpen(true);
        })
        .catch(() => setHits([]));
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const go = (h: Hit) => {
    setOpen(false);
    setQ("");
    router.push(`/dashboard/companies/${h.countryCode.toLowerCase()}/${h.id}`);
  };
  const visible = q.trim().length >= 2 ? hits : [];

  return (
    <div ref={ref} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => visible.length > 0 && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, visible.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else if (e.key === "Enter" && visible[active]) go(visible[active]!);
          else if (e.key === "Escape") setOpen(false);
          else return;
          e.preventDefault();
        }}
        placeholder="Search companies, org. no., email, phone…"
        aria-label="Search companies"
        role="combobox"
        aria-expanded={open && visible.length > 0}
        aria-controls={listId}
        className="h-9 w-full rounded-lg border border-ink-200 bg-ink-50 pl-9 pr-3 text-sm focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
      />
      {open && q.trim().length >= 2 && (
        <ul id={listId} role="listbox" className="absolute z-50 mt-1.5 max-h-96 w-full overflow-y-auto rounded-xl border border-ink-200 bg-white p-1 shadow-lifted sm:w-[32rem]">
          {visible.map((h, i) => (
            <li key={h.id} role="option" aria-selected={i === active}>
              <button type="button" onMouseEnter={() => setActive(i)} onClick={() => go(h)} className={cn("w-full rounded-lg px-3 py-2 text-left", i === active && "bg-ink-50")}>
                <span className="flex items-center gap-2 text-sm font-medium text-ink-900">
                  {h.name}
                  <span className="text-xs font-normal text-ink-500">
                    {h.countryCode}
                    {h.registrationNumber ? ` · ${h.registrationNumber}` : ""}
                  </span>
                  {h.isDemo && <span className="rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-900">DEMO</span>}
                </span>
                <span className="block truncate text-xs text-ink-500">{[h.registrationDay && `Registered ${h.registrationDay}`, h.city, h.email, h.phone && formatPhone(h.phone), h.website && displayWebsite(h.website)].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
          {visible.length === 0 && <li className="px-3 py-2 text-sm text-ink-500">No companies found.</li>}
        </ul>
      )}
    </div>
  );
}
