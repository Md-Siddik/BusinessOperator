"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";

const OPTIONS = [
  [90, "3 months"],
  [180, "6 months"],
  [395, "13 months (default)"],
  [760, "25 months"],
] as const;

/** Retention of analytics records (saved through the Owner-only settings API). */
export function RetentionForm({ current }: { current: number }) {
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [state, setState] = useState<{ saving: boolean; message?: string; error?: string }>({ saving: false });
  const options = OPTIONS.some(([d]) => d === current) ? OPTIONS : [...OPTIONS, [current, `${current} days`] as const];
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setState({ saving: true });
        try {
          await apiFetch("/api/admin/settings/analytics", { method: "PUT", body: { retentionDays: value } });
          setState({ saving: false, message: "Saved. Applies to activity recorded from now on." });
          router.refresh();
        } catch (err) {
          setState({ saving: false, error: err instanceof ApiError ? err.message : "Could not save." });
        }
      }}
    >
      <label htmlFor="wa-retention" className="text-sm text-ink-700">
        Keep analytics records for
      </label>
      <select id="wa-retention" value={value} onChange={(e) => setValue(Number(e.target.value))} className="h-8 rounded-lg border border-ink-200 bg-white px-2 text-sm text-ink-800">
        {options.map(([d, label]) => (
          <option key={d} value={d}>
            {label}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" variant="outline" disabled={state.saving || value === current}>
        {state.saving ? "Saving…" : "Save"}
      </Button>
      {state.message && <span className="text-xs text-emerald-700">{state.message}</span>}
      {state.error && <span className="text-xs text-red-700">{state.error}</span>}
    </form>
  );
}
