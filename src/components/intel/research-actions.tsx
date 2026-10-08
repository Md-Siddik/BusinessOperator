"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CheckCircle2, CircleDashed, CloudDownload, PencilLine, SearchCheck, XCircle } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";

type Step = { step: string; status: "done" | "skipped" | "nothing" | "failed"; detail: string };
const STEP_LABELS: Record<string, string> = {
  registry: "Official registry",
  discovery: "Website discovery",
  website: "Website contact page",
  provider: "Enrichment provider",
  verification: "Verification",
};

export function ResearchActions({
  companyId,
  canRefresh,
  canFind,
  canEdit,
  isDemo,
  current,
}: {
  companyId: string;
  canRefresh: boolean;
  canFind: boolean;
  canEdit: boolean;
  isDemo: boolean;
  current: { email?: string; phone?: string; mobile?: string; website?: string; contactPersonName?: string; contactPersonRole?: string };
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  async function refresh() {
    setPending("refresh");
    try {
      await apiFetch(`/api/companies/${companyId}/refresh`, { body: {} });
      toast.success("Refreshed from the registry");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Refresh failed");
    } finally {
      setPending(null);
    }
  }

  async function find() {
    setPending("find");
    try {
      const r = await apiFetch<{ steps: Step[]; filled: string[] }>(`/api/companies/${companyId}/enrich`, { body: {} });
      setSteps(r.steps);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Contact lookup failed");
    } finally {
      setPending(null);
    }
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = Object.fromEntries(["email", "phone", "mobile", "website", "contactPersonName", "contactPersonRole"].map((k) => [k, String(f.get(k) ?? "").trim()]));
    setPending("edit");
    try {
      await apiFetch(`/api/companies/${companyId}`, { method: "PATCH", body });
      toast.success("Contact details saved (source: added manually)");
      setEditOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canRefresh && !isDemo && (
        <Button variant="outline" size="sm" loading={pending === "refresh"} onClick={refresh}>
          <CloudDownload className="h-4 w-4" aria-hidden /> Refresh from registry
        </Button>
      )}
      {canFind && !isDemo && (
        <Button variant="outline" size="sm" loading={pending === "find"} onClick={find}>
          <SearchCheck className="h-4 w-4" aria-hidden /> Find contact details
        </Button>
      )}
      {canEdit && (
        <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
          <PencilLine className="h-4 w-4" aria-hidden /> Edit contact details
        </Button>
      )}

      <Modal open={!!steps} onClose={() => setSteps(null)} title="Contact lookup" description="Only values that can be attributed to a source are stored. Nothing is guessed." size="md">
        <ol className="space-y-3">
          {steps?.map((s) => (
            <li key={s.step} className="flex gap-3 text-sm">
              {s.status === "done" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> : s.status === "failed" ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden /> : <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden />}
              <div>
                <p className="font-medium text-ink-900">
                  {STEP_LABELS[s.step] ?? s.step} <span className="font-normal text-ink-500">· {s.status === "nothing" ? "nothing found" : s.status}</span>
                </p>
                <p className="text-ink-600">{s.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </Modal>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit contact details" description="Manual values are labelled “Added manually” and are never overwritten by registry syncs. Leave a field empty to remove it." size="md">
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["email", "Email", "email", current.email],
              ["phone", "Phone", "tel", current.phone],
              ["mobile", "Mobile", "tel", current.mobile],
              ["website", "Website", "url", current.website],
              ["contactPersonName", "Contact person", "text", current.contactPersonName],
              ["contactPersonRole", "Contact person role", "text", current.contactPersonRole],
            ] as const
          ).map(([name, label, type, value]) => (
            <label key={name} className="text-sm">
              <span className="mb-1 block font-medium text-ink-700">{label}</span>
              <Input name={name} type={type} defaultValue={value ?? ""} />
            </label>
          ))}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending === "edit"}>
              Save
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
