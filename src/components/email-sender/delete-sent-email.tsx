"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/** Removes one record from the Sent emails history (the email itself is not recalled). */
export function DeleteSentEmail({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  async function remove() {
    if (!confirm("Delete this email from the history? This cannot be undone.")) return;
    setPending(true);
    try {
      await apiFetch(`/api/email-sender/history/${id}`, { method: "DELETE" });
      toast.success("Email deleted");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not delete the email");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button size="xs" variant="ghost" loading={pending} onClick={() => void remove()} aria-label="Delete email" title="Delete">
      <Trash2 className="h-4 w-4" aria-hidden />
    </Button>
  );
}
