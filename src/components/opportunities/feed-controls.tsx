"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CloudDownload, Plus, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

type SettingField = { key: string; label: string; help: string; kind: "list" | "text" | "number"; defaultValue: string | number };
type FeedConfigField = { key: string; label: string; placeholder?: string; required?: boolean; help?: string };

function useRun() {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setPending(key);
    try {
      await fn();
      toast.success(ok);
      router.refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Something went wrong");
      return false;
    } finally {
      setPending(null);
    }
  }
  return { pending, run };
}

/** Enable / sync / reset for one feed. Agreement-bound providers require explicit terms confirmation. */
export function FeedControls({ id, enabled, configured, requiresAgreement, kind, canVerify }: { id: string; enabled: boolean; configured: boolean; requiresAgreement?: boolean; kind: "PROVIDER" | "EMPLOYER"; canVerify?: boolean }) {
  const { pending, run } = useRun();
  const [ack, setAck] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {requiresAgreement && !enabled && configured && (
        <label className="flex items-center gap-1.5 text-xs text-ink-700">
          <input type="checkbox" className="accent-brand-600" checked={ack} onChange={(e) => setAck(e.target.checked)} />I confirm my use complies with this provider&apos;s terms
        </label>
      )}
      <Button
        size="sm"
        variant={enabled ? "outline" : "primary"}
        disabled={!configured || (requiresAgreement && !enabled && !ack)}
        loading={pending === "toggle"}
        title={configured ? undefined : "Set the required environment variables on the server first"}
        onClick={() => run("toggle", () => apiFetch(`/api/opportunities/feeds/${id}`, { method: "PATCH", body: { enabled: !enabled, acknowledgeTerms: ack || undefined } }), enabled ? "Feed disabled" : "Feed enabled")}
      >
        {enabled ? "Disable" : "Enable"}
      </Button>
      {enabled && configured && (
        <Button size="sm" variant="outline" loading={pending === "sync"} onClick={() => run("sync", () => apiFetch(`/api/opportunities/feeds/${id}/sync`, { body: {} }), "Sync queued — the worker runs it within about a minute.")}>
          <CloudDownload className="h-4 w-4" aria-hidden /> Sync now
        </Button>
      )}
      {canVerify && (
        <Button size="sm" variant="outline" loading={pending === "verify"} onClick={() => run("verify", () => apiFetch(`/api/opportunities/feeds/${id}/verify`, { body: {} }), "Board link re-checked")}>
          <ShieldCheck className="h-4 w-4" aria-hidden /> Re-verify link
        </Button>
      )}
      {kind === "PROVIDER" && (
        <Button size="sm" variant="ghost" loading={pending === "reset"} title="Re-read from the initial backfill window on the next run (idempotent)" onClick={() => run("reset", () => apiFetch(`/api/opportunities/feeds/${id}`, { method: "PATCH", body: { resetCursor: true } }), "Cursor reset — next run re-reads the backfill window")}>
          <RotateCcw className="h-4 w-4" aria-hidden /> Reset cursor
        </Button>
      )}
      {kind === "EMPLOYER" && (
        <Button
          size="sm"
          variant="ghost"
          loading={pending === "delete"}
          onClick={() => {
            if (window.confirm("Remove this employer feed? Stored opportunities and their evidence are kept.")) void run("delete", () => apiFetch(`/api/opportunities/feeds/${id}`, { method: "DELETE" }), "Employer feed removed");
          }}
        >
          <Trash2 className="h-4 w-4" aria-hidden /> Remove
        </Button>
      )}
    </div>
  );
}

/** Scope settings for one provider feed (CPV codes, occupation fields, keywords …). */
export function FeedSettingsForm({ id, fields, values, intervalMinutes }: { id: string; fields: SettingField[]; values: Record<string, unknown>; intervalMinutes: number }) {
  const { pending, run } = useRun();
  const [state, setState] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, String(values[f.key] ?? f.defaultValue)])));
  const [intervalValue, setIntervalValue] = useState(String(intervalMinutes));
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const settings = Object.fromEntries(fields.map((f) => [f.key, f.kind === "number" ? Number(state[f.key]) : state[f.key]!]));
        void run("save", () => apiFetch(`/api/opportunities/feeds/${id}`, { method: "PATCH", body: { settings, intervalMinutes: Number(intervalValue) } }), "Settings saved");
      }}
    >
      {fields.map((f) => (
        <div key={f.key}>
          <label htmlFor={`${id}-${f.key}`} className="mb-1 block text-xs font-medium text-ink-700">
            {f.label}
          </label>
          <Input id={`${id}-${f.key}`} type={f.kind === "number" ? "number" : "text"} value={state[f.key]} onChange={(e) => setState((s) => ({ ...s, [f.key]: e.target.value }))} className="h-9" aria-describedby={`${id}-${f.key}-help`} />
          <p id={`${id}-${f.key}-help`} className="mt-1 text-xs text-ink-500">
            {f.help}
          </p>
        </div>
      ))}
      <div>
        <label htmlFor={`${id}-interval`} className="mb-1 block text-xs font-medium text-ink-700">
          Sync interval (minutes)
        </label>
        <Input id={`${id}-interval`} type="number" min={15} value={intervalValue} onChange={(e) => setIntervalValue(e.target.value)} className="h-9 w-32" />
      </div>
      <Button type="submit" size="sm" variant="outline" loading={pending === "save"}>
        Save settings
      </Button>
    </form>
  );
}

/** Add an employer feed (ATS board or official careers page). */
export function AddEmployerFeed({ providers }: { providers: { id: string; name: string; fields: FeedConfigField[] }[] }) {
  const { pending, run } = useRun();
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [companyQuery, setCompanyQuery] = useState("");
  const [companies, setCompanies] = useState<{ id: string; name: string; registrationNumber?: string; countryCode: string }[]>([]);
  const [companyId, setCompanyId] = useState<string>("");
  const provider = providers.find((p) => p.id === providerId);

  async function searchCompanies(q: string) {
    setCompanyQuery(q);
    if (q.trim().length < 2) return setCompanies([]);
    try {
      setCompanies(await apiFetch(`/api/opportunities/companies?q=${encodeURIComponent(q)}`));
    } catch {
      setCompanies([]);
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run("add", () => apiFetch("/api/opportunities/feeds", { body: { providerId, config, companyId: companyId || undefined } }), "Employer feed added — verification and first sync are running.").then((ok) => {
          if (ok) {
            setConfig({});
            setCompanyId("");
            setCompanyQuery("");
          }
        });
      }}
    >
      <div>
        <label htmlFor="feed-provider" className="mb-1 block text-xs font-medium text-ink-700">
          Source type
        </label>
        <select id="feed-provider" value={providerId} onChange={(e) => setProviderId(e.target.value)} className="h-9 w-full rounded-lg border border-ink-200 bg-white px-2.5 text-sm">
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {provider?.fields.map((f) => (
          <div key={f.key}>
            <label htmlFor={`cfg-${f.key}`} className="mb-1 block text-xs font-medium text-ink-700">
              {f.label}
              {f.required && <span className="text-red-600"> *</span>}
            </label>
            <Input id={`cfg-${f.key}`} required={f.required} placeholder={f.placeholder} value={config[f.key] ?? ""} onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))} className="h-9" />
            {f.help && <p className="mt-1 text-xs text-ink-500">{f.help}</p>}
          </div>
        ))}
      </div>
      <div>
        <label htmlFor="feed-company" className="mb-1 block text-xs font-medium text-ink-700">
          Link to a Company Intelligence record (optional)
        </label>
        <Input id="feed-company" value={companyQuery} onChange={(e) => void searchCompanies(e.target.value)} placeholder="Registration number or company name" className="h-9" autoComplete="off" />
        {companies.length > 0 && (
          <ul className="mt-1 max-h-40 overflow-auto rounded-lg border border-ink-200 bg-white text-sm" role="listbox" aria-label="Matching companies">
            {companies.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={companyId === c.id}
                  onClick={() => {
                    setCompanyId(c.id);
                    setCompanyQuery(`${c.name} (${c.countryCode}${c.registrationNumber ? ` ${c.registrationNumber}` : ""})`);
                    setCompanies([]);
                  }}
                  className="block w-full px-3 py-1.5 text-left hover:bg-ink-50"
                >
                  {c.name} <span className="text-xs text-ink-500">{c.countryCode} {c.registrationNumber}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-ink-500">You choose the record explicitly — ExploreTechify never links companies by name similarity.</p>
      </div>
      <Button type="submit" size="sm" loading={pending === "add"}>
        <Plus className="h-4 w-4" aria-hidden /> Add employer feed
      </Button>
    </form>
  );
}
