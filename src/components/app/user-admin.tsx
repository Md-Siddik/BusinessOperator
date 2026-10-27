"use client";

import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api/client";
import { Button } from "@/components/ui/button";

// Account and permission management lives in access-manager.tsx (Users & access).

export function MarkAllReadButton() {
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() =>
        void apiFetch("/api/notifications", { body: {} }).then(() => router.refresh())
      }
    >
      Mark all as read
    </Button>
  );
}
