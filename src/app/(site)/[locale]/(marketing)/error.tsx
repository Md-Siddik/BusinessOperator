"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Friendly error boundary — never shows stack traces. */
export default function MarketingError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <section className="container-page flex min-h-[50vh] flex-col items-center justify-center py-24 text-center">
      <h1 className="text-2xl font-semibold text-ink-900">Something went wrong</h1>
      <p className="mt-2 text-ink-600">An unexpected error occurred. Please try again.</p>
      {error.digest && <p className="mt-2 text-xs text-ink-400">Reference: {error.digest}</p>}
      <Button className="mt-6" onClick={reset}>
        Try again
      </Button>
    </section>
  );
}
