"use client";

/**
 * Mark one notification read through the existing endpoint (POST /api/notifications { ids }).
 * The server only updates the signed-in user's own unread notifications, so reopening a read
 * notification changes nothing. `keepalive` lets the request finish when opening the
 * notification navigates away. Resolves to false when the request failed.
 */
export async function markNotificationRead(id: string): Promise<boolean> {
  try {
    const res = await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
      credentials: "same-origin",
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}
