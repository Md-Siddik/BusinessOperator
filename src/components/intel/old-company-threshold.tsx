"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";

/** Owner: the Old company Intelligence age threshold (independent of Startup Company Intelligence). */
export function OldCompanyThreshold({ value, pinned }: { value: number; pinned: boolean }) {
  const router = useRouter();
  const [years, setYears] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/old-companies/config", { method: "PUT", body: { minAgeYears: Number(years) } });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the threshold.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-2">
      <label className="text-xs font-medium text-ink-600">
        Established after (years)
        <input
          type="number"
          min={1}
          max={100}
          required
          disabled={pinned || saving}
          value={years}
          onChange={(e) => setYears(e.target.value)}
          className="mt-1 block h-9 w-24 rounded-lg border border-ink-200 bg-white px-2 text-sm text-ink-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-ink-50"
        />
      </label>
      <Button size="sm" type="submit" disabled={pinned || saving || Number(years) === value}>
        {saving ? "Saving…" : "Save"}
      </Button>
      {pinned && <p className="w-full text-xs text-ink-500">Pinned by ESTABLISHED_MIN_AGE_YEARS on this deployment.</p>}
      {error && (
        <p role="alert" className="w-full text-xs text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
