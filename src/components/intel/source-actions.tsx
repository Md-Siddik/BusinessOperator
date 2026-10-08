"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Activity, CloudDownload } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/** "Check now" (reachability) and "Sync" (incremental catch-up) for one country's provider. */
export function SourceActions({ country, canSync, dailyFeed }: { country: string; canSync: boolean; dailyFeed: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);

  async function check() {
    setPending("check");
    try {
      const s = await apiFetch<{ state: string; message?: string }>(`/api/registry/status/${country}`, { body: {} });
      if (s.state === "CONNECTED") toast.success("Provider is reachable");
      else toast.error(`${s.state.replace(/_/g, " ").toLowerCase()}${s.message ? ` — ${s.message}` : ""}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Check failed");
    } finally {
      setPending(null);
    }
  }

  async function sync() {
    setPending("sync");
    try {
      await apiFetch("/api/registry/sync", { body: { country, kind: "BACKFILL" } });
      toast.success("Sync started — it runs in the background.");
      setTimeout(() => router.refresh(), 1500);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not start the sync");
    } finally {
      setPending(null);
    }
  }

  if (!canSync) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" loading={pending === "check"} onClick={check}>
        <Activity className="h-4 w-4" aria-hidden /> Check now
      </Button>
      {dailyFeed && (
        <Button size="sm" variant="outline" loading={pending === "sync"} onClick={sync}>
          <CloudDownload className="h-4 w-4" aria-hidden /> Sync since last run
        </Button>
      )}
    </div>
  );
}
