"use client";

import { useEffect, useRef } from "react";
import type { RealtimeEvent } from "@/lib/realtime";

/**
 * Subscribe to server-sent realtime events for the signed-in user.
 * EventSource reconnects automatically; the handler ref avoids resubscribing on re-render.
 */
export function useRealtime(onEvent: (event: RealtimeEvent) => void, enabled = true) {
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });
  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    const source = new EventSource("/api/realtime");
    source.onmessage = (e) => {
      try {
        handler.current(JSON.parse(e.data) as RealtimeEvent);
      } catch {
        /* ignore malformed events */
      }
    };
    return () => source.close();
  }, [enabled]);
}
