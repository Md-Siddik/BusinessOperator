"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" aria-hidden />
      <h1 className="mt-4 text-lg font-semibold">This page couldn&apos;t be loaded</h1>
      <p className="mt-1 text-sm text-ink-500">Something went wrong on our side. Please try again.</p>
      {error.digest && <p className="mt-2 text-xs text-ink-400">Reference: {error.digest}</p>}
      <Button className="mt-6" onClick={reset}>
        Retry
      </Button>
    </div>
  );
}
