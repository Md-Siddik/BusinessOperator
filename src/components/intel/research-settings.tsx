"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { ResearchSettings } from "@/features/settings/schemas";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

const PROVIDERS = [
  { id: "brave", label: "Brave Search API", env: "BRAVE_SEARCH_API_KEY", what: "Finds candidate websites / public pages (verified by registration number before use)" },
  { id: "hunter", label: "Hunter", env: "HUNTER_API_KEY", what: "Domain Search (sourced emails), Email Verifier, Domain Finder (beta, review only)" },
  { id: "apollo", label: "Apollo", env: "APOLLO_API_KEY", what: "Organization enrichment — corporate phone for a confirmed domain" },
] as const;

/** Owner controls for contact research: depth, retries, providers, budgets, targeting, inbox volume. */
export function ResearchSettingsForm({ value, keys }: { value: ResearchSettings; keys: Record<string, boolean> }) {
  const router = useRouter();
  const toast = useToast();
  const [s, setS] = useState(value);
  const [pending, setPending] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      await apiFetch("/api/admin/settings/research", { method: "PUT", body: s });
      toast.success("Research settings saved");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save");
    } finally {
      setPending(false);
    }
  }
  const num = (v: string) => (v === "" ? 0 : Number(v));
  return (
    <form onSubmit={submit} className="space-y-6 text-sm">
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 font-semibold">Research</legend>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} className="h-4 w-4" /> Automatic contact research
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={s.websiteDiscovery} onChange={(e) => setS({ ...s, websiteDiscovery: e.target.checked })} className="h-4 w-4" /> Website discovery when no website is listed
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-ink-500">Retry schedule (days, comma-separated)</span>
          <Input value={s.retryDays.join(", ")} onChange={(e) => setS({ ...s, retryDays: e.target.value.split(",").map((x) => Number(x.trim())).filter((x) => x > 0) })} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-ink-500">Backfill window (days, newest first)</span>
          <Input type="number" min={0} max={365} value={s.backfillDays} onChange={(e) => setS({ ...s, backfillDays: num(e.target.value) })} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-ink-500">Max pages per website</span>
          <Input type="number" min={1} max={10} value={s.maxPagesPerWebsite} onChange={(e) => setS({ ...s, maxPagesPerWebsite: num(e.target.value) })} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-ink-500">Shared-contact threshold (intermediary)</span>
          <Input type="number" min={2} max={50} value={s.sharedContactThreshold} onChange={(e) => setS({ ...s, sharedContactThreshold: num(e.target.value) })} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-ink-500">Cache negative paid lookups (days)</span>
          <Input type="number" min={1} max={180} value={s.negativeCacheDays} onChange={(e) => setS({ ...s, negativeCacheDays: num(e.target.value) })} />
        </label>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 font-semibold">Paid providers (contact data only — no sending)</legend>
        {PROVIDERS.map((p) => {
          const cfg = s.providers[p.id];
          return (
            <div key={p.id} className="grid gap-3 rounded-lg border border-ink-200 p-3 sm:grid-cols-[1fr_7rem_9rem]">
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={cfg.enabled} onChange={(e) => setS({ ...s, providers: { ...s.providers, [p.id]: { ...cfg, enabled: e.target.checked } } })} className="mt-0.5 h-4 w-4" />
                <span>
                  <span className="font-medium">{p.label}</span> <span className={keys[p.env] ? "text-xs text-emerald-700" : "text-xs text-amber-700"}>{keys[p.env] ? "key configured" : `set ${p.env}`}</span>
                  <span className="block text-xs text-ink-500">{p.what}</span>
                </span>
              </label>
              <label>
                <span className="mb-1 block text-xs text-ink-500">Priority</span>
                <Input type="number" min={1} max={10} value={cfg.priority} onChange={(e) => setS({ ...s, providers: { ...s.providers, [p.id]: { ...cfg, priority: num(e.target.value) } } })} />
              </label>
              <label>
                <span className="mb-1 block text-xs text-ink-500">Cost per call (cents)</span>
                <Input type="number" min={0} step="0.1" value={cfg.costCentsPerCall} onChange={(e) => setS({ ...s, providers: { ...s.providers, [p.id]: { ...cfg, costCentsPerCall: num(e.target.value) } } })} />
              </label>
            </div>
          );
        })}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={s.verifyEmailsWithHunter} onChange={(e) => setS({ ...s, verifyEmailsWithHunter: e.target.checked })} className="h-4 w-4" /> Verify found emails with Hunter Email Verifier (paid)
        </label>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 font-semibold">Budgets (cents; 0 = paid lookups paused)</legend>
        <label>
          <span className="mb-1 block text-xs text-ink-500">Daily budget</span>
          <Input type="number" min={0} value={s.dailyBudgetCents} onChange={(e) => setS({ ...s, dailyBudgetCents: num(e.target.value) })} />
        </label>
        <label>
          <span className="mb-1 block text-xs text-ink-500">Monthly budget</span>
          <Input type="number" min={0} value={s.monthlyBudgetCents} onChange={(e) => setS({ ...s, monthlyBudgetCents: num(e.target.value) })} />
        </label>
        <label>
          <span className="mb-1 block text-xs text-ink-500">Max per company</span>
          <Input type="number" min={0} value={s.maxCostPerCompanyCents} onChange={(e) => setS({ ...s, maxCostPerCompanyCents: num(e.target.value) })} />
        </label>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 font-semibold">Paid research target profile (empty = all)</legend>
        <label>
          <span className="mb-1 block text-xs text-ink-500">Countries (codes, comma-separated)</span>
          <Input value={s.paidTargets.countries.join(", ")} onChange={(e) => setS({ ...s, paidTargets: { ...s.paidTargets, countries: e.target.value.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean) } })} />
        </label>
        <label>
          <span className="mb-1 block text-xs text-ink-500">Industries (keys, comma-separated)</span>
          <Input value={s.paidTargets.industries.join(", ")} onChange={(e) => setS({ ...s, paidTargets: { ...s.paidTargets, industries: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) as ResearchSettings["paidTargets"]["industries"] } })} />
        </label>
        <label>
          <span className="mb-1 block text-xs text-ink-500">Max company age (days)</span>
          <Input type="number" min={0} max={365} value={s.paidTargets.maxAgeDays} onChange={(e) => setS({ ...s, paidTargets: { ...s.paidTargets, maxAgeDays: num(e.target.value) } })} />
        </label>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 font-semibold">Research inbox volume</legend>
        {(
          [
            ["newContactable", "Newly contactable companies"],
            ["verificationChanges", "Verification changes"],
            ["serviceMatches", "Strong service matches"],
            ["reviewNeeded", "Contacts needing review"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2">
            <input type="checkbox" checked={s.inbox[k]} onChange={(e) => setS({ ...s, inbox: { ...s.inbox, [k]: e.target.checked } })} className="h-4 w-4" /> {label}
          </label>
        ))}
        <label>
          <span className="mb-1 block text-xs text-ink-500">Min service-fit score for inbox</span>
          <Input type="number" min={0} max={100} value={s.inbox.minServiceFitScore} onChange={(e) => setS({ ...s, inbox: { ...s.inbox, minServiceFitScore: num(e.target.value) } })} />
        </label>
        <label>
          <span className="mb-1 block text-xs text-ink-500">Max new-contactable items per country/day (0 = no limit)</span>
          <Input type="number" min={0} value={s.inbox.maxPerCountryPerDay} onChange={(e) => setS({ ...s, inbox: { ...s.inbox, maxPerCountryPerDay: num(e.target.value) } })} />
        </label>
      </fieldset>
      <Button type="submit" loading={pending}>
        Save research settings
      </Button>
    </form>
  );
}

type Pkg = { id: string; name: string; group?: string; description?: string; deliverables: string[]; timeline?: string; currency: string; terms?: string; active: boolean; nextQuestion?: string; lineItems: { description: string; quantity: number; unitPrice?: number | null; unit?: string }[]; rules: { countries: string[]; industries: string[]; maxCompanyAgeDays?: number | null; requireDirectContact: boolean; requiresEvidence: string; weight: number } };

const EVIDENCE = ["none", "website_found", "website_not_found_after_research", "weak_website_audit", "hiring_signal", "direct_contact", "webmail_email"];

/** Owner-editable service packages: approved prices, deliverables and evidence-based targeting rules. */
export function PackageEditor({ pkg }: { pkg: Pkg }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const lines = String(f.get("lineItems") ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [description = "", qty = "1", price = "", unit = ""] = l.split("|").map((x) => x.trim());
        return { description, quantity: Number(qty) || 1, unitPrice: price === "" ? null : Number(price), unit: unit || undefined };
      });
    const body = {
      name: f.get("name"),
      group: f.get("group") || undefined,
      description: f.get("description") || undefined,
      deliverables: String(f.get("deliverables") ?? "").split("\n").map((x) => x.trim()).filter(Boolean),
      timeline: f.get("timeline") || undefined,
      currency: f.get("currency"),
      terms: f.get("terms") || undefined,
      nextQuestion: f.get("nextQuestion") || undefined,
      active: f.get("active") === "on",
      lineItems: lines,
      rules: {
        countries: String(f.get("countries") ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean),
        industries: String(f.get("industries") ?? "").split(",").map((x) => x.trim()).filter(Boolean),
        maxCompanyAgeDays: f.get("maxAge") ? Number(f.get("maxAge")) : null,
        requireDirectContact: f.get("requireDirect") === "on",
        requiresEvidence: f.get("evidence"),
        weight: Number(f.get("weight") || 50),
      },
    };
    setPending(true);
    try {
      await apiFetch(`/api/service-packages/${pkg.id}`, { method: "PATCH", body });
      toast.success(`${pkg.name} saved`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save");
    } finally {
      setPending(false);
    }
  }
  return (
    <details className="rounded-xl border border-ink-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
        {pkg.name} <span className="font-normal text-ink-500">· {pkg.group} {pkg.active ? "" : "· inactive"} · requires {pkg.rules.requiresEvidence.replace(/_/g, " ")}</span>
      </summary>
      <form onSubmit={submit} className="grid gap-3 border-t border-ink-100 p-4 text-sm sm:grid-cols-2">
        <label>
          Name <Input name="name" defaultValue={pkg.name} required />
        </label>
        <label>
          Group <Input name="group" defaultValue={pkg.group} />
        </label>
        <label className="sm:col-span-2">
          Description <Textarea name="description" rows={2} defaultValue={pkg.description} />
        </label>
        <label className="sm:col-span-2">
          Price lines (one per line: description | quantity | unit price | unit — leave price empty for a placeholder)
          <Textarea name="lineItems" rows={3} defaultValue={pkg.lineItems.map((l) => [l.description, l.quantity, l.unitPrice ?? "", l.unit ?? ""].join(" | ")).join("\n")} />
        </label>
        <label>
          Currency <Input name="currency" defaultValue={pkg.currency} maxLength={3} />
        </label>
        <label>
          Timeline <Input name="timeline" defaultValue={pkg.timeline} />
        </label>
        <label className="sm:col-span-2">
          Deliverables (one per line) <Textarea name="deliverables" rows={3} defaultValue={pkg.deliverables.join("\n")} />
        </label>
        <label className="sm:col-span-2">
          Terms <Textarea name="terms" rows={2} defaultValue={pkg.terms} />
        </label>
        <label>
          Required evidence
          <Select name="evidence" defaultValue={pkg.rules.requiresEvidence}>
            {EVIDENCE.map((e) => (
              <option key={e} value={e}>
                {e.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
        </label>
        <label>
          Weight (0–100) <Input name="weight" type="number" min={0} max={100} defaultValue={pkg.rules.weight} />
        </label>
        <label>
          Countries (empty = all) <Input name="countries" defaultValue={pkg.rules.countries.join(", ")} />
        </label>
        <label>
          Industries (empty = all) <Input name="industries" defaultValue={pkg.rules.industries.join(", ")} />
        </label>
        <label>
          Max company age (days) <Input name="maxAge" type="number" defaultValue={pkg.rules.maxCompanyAgeDays ?? ""} />
        </label>
        <label>
          Next research question <Input name="nextQuestion" defaultValue={pkg.nextQuestion} />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="requireDirect" defaultChecked={pkg.rules.requireDirectContact} className="h-4 w-4" /> Only when a direct contact exists
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="active" defaultChecked={pkg.active} className="h-4 w-4" /> Active
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" size="sm" loading={pending}>
            Save package
          </Button>
        </div>
      </form>
    </details>
  );
}
