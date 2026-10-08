"use client";

import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api/client";

export function InboxActions({ id, read }: { id: string; read: boolean }) {
  const router = useRouter();
  const act = (action: "read" | "archive") => apiFetch("/api/inbox", { method: "PATCH", body: { ids: [id], action } }).then(() => router.refresh());
  return (
    <div className="flex gap-2 text-xs">
      {!read && (
        <button type="button" onClick={() => void act("read")} className="text-ink-600 hover:text-ink-900">
          Mark read
        </button>
      )}
      <button type="button" onClick={() => void act("archive")} className="text-ink-600 hover:text-ink-900">
        Archive
      </button>
    </div>
  );
}
