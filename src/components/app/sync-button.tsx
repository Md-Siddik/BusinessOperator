"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/api/client";

/** Manual, country-specific registry sync. */
export function SyncButton({ country, isLive }: { country: string; isLive: boolean }) {
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const router = useRouter();
  async function run() {
    setPending(true);
    try {
      const r = await apiFetch<{ status: string; imported: number; updated: number; failed: number; newlyQualified: number }>("/api/registry/sync", { body: { country } });
      toast.success(`${isLive ? "" : "Demo "}sync ${r.status.toLowerCase()}: ${r.imported} new, ${r.updated} updated, ${r.newlyQualified} newly qualified.`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Sync failed");
    } finally {
      setPending(false);
    }
  }
  return (
    <Button variant="outline" size="sm" onClick={run} loading={pending}>
      {!pending && <RefreshCw className="h-4 w-4" aria-hidden />} Sync registry
    </Button>
  );
}
