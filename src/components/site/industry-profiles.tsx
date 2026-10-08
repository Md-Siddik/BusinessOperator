"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type ProfileView = { key: string; title: string; text: string; items: string[] };

/** Industry personalisation: one reusable configuration, rendered as an accessible tab list. */
export function IndustryProfiles({ profiles }: { profiles: ProfileView[] }) {
  const [active, setActive] = useState(profiles[0]?.key);
  const current = profiles.find((p) => p.key === active) ?? profiles[0];
  if (!current) return null;
  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
      <div role="tablist" aria-orientation="vertical" className="scroll-thin flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
        {profiles.map((p) => (
          <button
            key={p.key}
            role="tab"
            type="button"
            id={`tab-${p.key}`}
            aria-selected={p.key === current.key}
            aria-controls={`panel-${p.key}`}
            onClick={() => setActive(p.key)}
            className={cn(
              "shrink-0 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors",
              p.key === current.key ? "border-brand-200 bg-brand-50 text-brand-800" : "border-ink-200 bg-white text-ink-700 hover:border-ink-300",
            )}
          >
            {p.title}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${current.key}`} aria-labelledby={`tab-${current.key}`} className="rounded-2xl border border-ink-200 bg-white p-6 shadow-card sm:p-8">
        <h3 className="text-xl font-semibold tracking-tight text-ink-900">{current.title}</h3>
        <p className="mt-2 max-w-xl text-ink-600">{current.text}</p>
        <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
          {current.items.map((item) => (
            <li key={item} className="flex items-center gap-3 rounded-xl bg-ink-50 px-4 py-3 text-sm font-medium text-ink-800">
              <Check className="h-4 w-4 text-brand-600" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
