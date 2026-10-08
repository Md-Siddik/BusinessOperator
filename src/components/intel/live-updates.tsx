"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeEvent } from "@/lib/realtime";
import { Radio } from "lucide-react";
import { useRealtimeEvents } from "@/components/app/live-counts";

/**
 * Live intelligence updates for this country (pushed by server-side workers over SSE).
 * Rows are never moved during interaction: the list refreshes automatically only
 * when the user has been idle for 15 s and no drawer / dialog is open; otherwise a
 * banner offers the refresh.
 */
export function LiveUpdates({ country }: { country: string }) {
  const router = useRouter();
  const [pending, setPending] = useState({ registrations: 0, contacts: 0 });
  const lastActivity = useRef(0);

  useEffect(() => {
    lastActivity.current = Date.now();
    const mark = () => (lastActivity.current = Date.now());
    window.addEventListener("pointerdown", mark);
    window.addEventListener("keydown", mark);
    window.addEventListener("scroll", mark, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", mark);
      window.removeEventListener("keydown", mark);
      window.removeEventListener("scroll", mark);
    };
  }, []);

  const onEvent = useCallback(
    (e: RealtimeEvent) => {
      if (e.type !== "intel.updated") return;
      if (country !== "ALL" && e.countryCode !== country) return;
      if (e.kind === "research") return;
      setPending((p) => ({ registrations: p.registrations + (e.kind === "registrations" ? e.count : 0), contacts: p.contacts + (e.kind === "contacts" ? e.count : 0) }));
    },
    [country],
  );
  useRealtimeEvents(onEvent);

  useEffect(() => {
    if (!pending.registrations && !pending.contacts) return;
    const t = setInterval(() => {
      const busy = Date.now() - lastActivity.current < 15_000 || document.querySelector("[role=dialog]") || document.activeElement?.closest("input,textarea,select");
      if (!busy) {
        setPending({ registrations: 0, contacts: 0 });
        router.refresh();
      }
    }, 5_000);
    return () => clearInterval(t);
  }, [pending, router]);

  if (!pending.registrations && !pending.contacts) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm text-brand-900" role="status" aria-live="polite">
      <span className="flex items-center gap-2">
        <Radio className="h-4 w-4 animate-pulse" aria-hidden />
        {[pending.registrations ? `${pending.registrations} new registration${pending.registrations === 1 ? "" : "s"}` : null, pending.contacts ? `${pending.contacts} company${pending.contacts === 1 ? "" : "ies"} newly contactable` : null].filter(Boolean).join(" · ")}
      </span>
      <button
        type="button"
        onClick={() => {
          setPending({ registrations: 0, contacts: 0 });
          router.refresh();
        }}
        className="rounded-lg bg-brand-600 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-700"
      >
        Show updates
      </button>
    </div>
  );
}
