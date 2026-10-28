"use client";

import { useEffect, useState } from "react";
import { Eye, LogOut, Repeat, Search } from "lucide-react";
import { Modal } from "@/components/ui/overlay";
import { Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { apiFetch } from "@/lib/api/client";
import { cn } from "@/lib/utils";

type RoleOption = { role: string; label: string; description: string; workspace: string; permissions: { key: string; label: string }[] };
type PreviewState = { active: { role: string; label: string } | null; roles: RoleOption[] };

/** Full reload: drops client state and reconnects live updates with the new effective role. */
function go(href: string) {
  window.location.assign(href);
}

/**
 * Owner only: pick a role to preview. Mounted only while open, so the list is fetched fresh each
 * time and roles and role-template changes appear without a reload.
 */
export function ViewAsRoleDialog({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<PreviewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<PreviewState>("/api/role-preview")
      .then(setState)
      .catch((e: Error) => setError(e.message));
  }, []);

  async function start(role: string) {
    setBusy(role);
    setError(null);
    try {
      const res = await apiFetch<{ home: string }>("/api/role-preview", { body: { role } });
      go(res.home);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const term = q.trim().toLowerCase();
  const roles = (state?.roles ?? []).filter((r) => !term || r.label.toLowerCase().includes(term) || r.description.toLowerCase().includes(term));

  return (
    <Modal open onClose={onClose} title="View as role" description="Browse the site with a role's current navigation and permissions. Read-only — nothing can be changed while previewing.">
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search roles" aria-label="Search roles" className="pl-9" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!state && !error ? (
          <div className="flex justify-center py-8">
            <Spinner className="text-brand-600" label="Loading roles" />
          </div>
        ) : roles.length === 0 && state ? (
          <p className="py-6 text-center text-sm text-ink-500">No roles match “{q}”.</p>
        ) : (
          <ul className="space-y-2">
            {roles.map((r) => {
              const current = state?.active?.role === r.role;
              return (
                <li key={r.role}>
                  <button
                    type="button"
                    disabled={!!busy || current}
                    onClick={() => start(r.role)}
                    className={cn("w-full rounded-xl border px-4 py-3 text-left transition hover:border-brand-300 hover:bg-brand-50/40 disabled:cursor-default", current ? "border-brand-300 bg-brand-50/60" : "border-ink-200")}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-medium text-ink-900">{r.label}</span>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-ink-500">
                        {busy === r.role && <Spinner className="h-3.5 w-3.5 text-brand-600" />}
                        {current ? "Current preview" : r.workspace}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-sm text-ink-500">{r.description}</span>
                    <span className="mt-1.5 block text-xs text-ink-500" title={r.permissions.map((p) => p.label).join(", ")}>
                      {r.role === "CLIENT" ? "Client portal (own organization only)" : r.permissions.length === 0 ? "No permissions in the role template" : `${r.permissions.length} permission${r.permissions.length === 1 ? "" : "s"} from the role template`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/** Shown on every page while the Owner previews a role: which role, plus switch and exit. */
export function RolePreviewBar({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  async function exit() {
    setBusy(true);
    const res = await apiFetch<{ home: string }>("/api/role-preview", { method: "DELETE" }).catch(() => ({ home: "/dashboard" }));
    go(res.home);
  }
  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-start px-4 sm:justify-center" role="status" aria-live="polite">
        <div className="pointer-events-auto flex max-w-[calc(100vw-6rem)] items-center gap-2 rounded-full border border-amber-300 bg-amber-50 py-1.5 pl-3 pr-1.5 text-sm text-amber-950 shadow-lifted sm:max-w-none">
          <Eye className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">
            Viewing as: <strong className="font-semibold">{label}</strong>
            <span className="hidden text-amber-800 sm:inline"> · read-only</span>
          </span>
          <button type="button" onClick={() => setPicker(true)} className="hidden shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium hover:bg-amber-100 sm:flex">
            <Repeat className="h-3.5 w-3.5" /> Switch
          </button>
          <Button size="xs" variant="dark" onClick={exit} loading={busy} className="shrink-0 rounded-full">
            {!busy && <LogOut className="h-3.5 w-3.5" />} Exit preview
          </Button>
        </div>
      </div>
      {picker && <ViewAsRoleDialog onClose={() => setPicker(false)} />}
    </>
  );
}
