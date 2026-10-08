"use client";

import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  return (
    <Button
      variant="outline"
      onClick={() =>
        // Full reload on sign-out drops all client state.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        void fetch("/api/auth/logout", { method: "POST" }).finally(() => window.location.assign("/login"))
      }
    >
      <LogOut className="h-4 w-4" aria-hidden /> Sign out
    </Button>
  );
}
