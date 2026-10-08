"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRealtime } from "@/hooks/use-realtime";
import type { RealtimeEvent } from "@/lib/realtime";

type Counts = { messages: number; notifications: number };
type Ctx = Counts & { refresh: () => void; subscribe: (fn: (e: RealtimeEvent) => void) => () => void };

const LiveCountsContext = createContext<Ctx | null>(null);

/**
 * One realtime connection per tab. Keeps badge counts live and fans events
 * out to subscribers (chat views) so pages don't open extra connections.
 */
export function LiveCountsProvider({ initial, children }: { initial: Counts; children: ReactNode }) {
  const [counts, setCounts] = useState(initial);
  const [listeners] = useState(() => new Set<(e: RealtimeEvent) => void>());

  const refresh = useCallback(() => {
    fetch("/api/messages/unread", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Counts | null) => d && setCounts(d))
      .catch(() => undefined);
  }, []);

  useRealtime((event) => {
    if (event.type === "notification") setCounts((c) => ({ ...c, notifications: event.unreadCount }));
    if (event.type === "message.created" || event.type === "message.read") refresh();
    listeners.forEach((fn) => fn(event));
  });

  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const subscribe = useCallback(
    (fn: (e: RealtimeEvent) => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    [listeners],
  );

  return <LiveCountsContext.Provider value={{ ...counts, refresh, subscribe }}>{children}</LiveCountsContext.Provider>;
}

export function useLiveCounts() {
  const ctx = useContext(LiveCountsContext);
  if (!ctx) throw new Error("useLiveCounts must be used inside LiveCountsProvider");
  return ctx;
}

/** Subscribe a component to realtime events via the shared connection. */
export function useRealtimeEvents(handler: (e: RealtimeEvent) => void) {
  const { subscribe } = useLiveCounts();
  useEffect(() => subscribe(handler), [subscribe, handler]);
}
