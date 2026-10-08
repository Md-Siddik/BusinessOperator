"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Plus, Send, ShieldBan, Sparkles, Trash2 } from "lucide-react";
import { COUNTRIES } from "@/config/countries";
import { INDUSTRIES, INDUSTRY_LABELS } from "@/config/industries";
import { LANGUAGES } from "@/config/languages";
import { SERVICE_CATEGORIES } from "@/config/services";
import { LEAD_STAGES, LEAD_STAGE_LABELS, SUPPRESSION_REASONS } from "@/lib/constants";
import { TEMPLATE_VARIABLES } from "@/lib/email/render";
import { apiFetch, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { Alert } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";

function useSubmit() {
  const toast = useToast();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string>();
  async function submit<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
    setPending(true);
    setErrors({});
    setError(undefined);
    try {
      const r = await fn();
      if (success) toast.success(success);
      router.refresh();
      return r;
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors ?? {});
        setError(e.message);
      } else setError("Something went wrong");
      return undefined;
    } finally {
      setPending(false);
    }
  }
  return { pending, errors, error, submit, router, toast };
}

export function NewCampaignButton({ templates, defaultCountry }: { templates: { id: string; label: string; countryCode: string; languageCode: string }[]; defaultCountry: string }) {
  const [open, setOpen] = useState(false);
  const { pending, errors, error, submit, router } = useSubmit();
  const [country, setCountry] = useState(defaultCountry === "ALL" ? "NO" : defaultCountry);
  const usable = templates.filter((t) => t.countryCode === country || t.countryCode === "INTL");
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    void submit(
      () =>
        apiFetch<{ _id: string }>("/api/campaigns", {
          body: {
            name: fd.get("name"),
            countryCode: fd.get("countryCode"),
            languageCode: fd.get("languageCode"),
            industry: fd.get("industry"),
            templateId: fd.get("templateId"),
            status: "ACTIVE",
            segment: {
              minScore: Number(fd.get("minScore") || 0),
              requireEmail: true,
              stages: fd.getAll("stages"),
              registeredWithinDays: fd.get("registeredWithinDays") ? Number(fd.get("registeredWithinDays")) : undefined,
              noWebsiteOnly: fd.get("noWebsiteOnly") === "on",
            },
          },
        }),
      "Campaign created",
    ).then((c) => c && router.push(`/dashboard/outreach/campaigns/${c._id}`));
  }
  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus className="h-4 w-4" aria-hidden /> New campaign
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="New campaign" description="Campaigns are always country-specific. Language is chosen separately — a country never implies a language." size="lg">
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Campaign name" error={errors.name}>
            {(p) => <Input {...p} name="name" required placeholder="e.g. Norway — new AS without website" />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Country" error={errors.countryCode}>
              {(p) => (
                <Select {...p} name="countryCode" value={country} onChange={(e) => setCountry(e.target.value)}>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Language" error={errors.languageCode}>
              {(p) => (
                <Select {...p} name="languageCode" defaultValue={COUNTRIES.find((c) => c.code === country)?.suggestedLanguages[0] ?? "en"} key={country}>
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.englishName}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Industry" optional="optional">
              {(p) => (
                <Select {...p} name="industry" defaultValue="">
                  <option value="">All industries</option>
                  {INDUSTRIES.map((i) => (
                    <option key={i} value={i}>
                      {INDUSTRY_LABELS[i]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Template" error={errors.templateId} hint={usable.length ? undefined : "No templates for this country yet — create one first."}>
            {(p) => (
              <Select {...p} name="templateId" required>
                {usable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <fieldset className="rounded-xl border border-ink-200 p-4">
            <legend className="px-1 text-sm font-medium">Target segment</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Minimum lead score">{(p) => <Input {...p} name="minScore" type="number" min={0} max={100} defaultValue={50} />}</Field>
              <Field label="Registered within (days)" optional="optional">
                {(p) => <Input {...p} name="registeredWithinDays" type="number" min={1} max={3650} placeholder="e.g. 60" />}
              </Field>
            </div>
            <p className="mb-2 mt-4 text-sm font-medium">Lead stages</p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {LEAD_STAGES.filter((s) => !["CLIENT", "DO_NOT_CONTACT", "NOT_INTERESTED", "WON"].includes(s)).map((s) => (
                <Checkbox key={s} name="stages" value={s} defaultChecked={s === "QUALIFIED" || s === "READY_FOR_OUTREACH"} label={LEAD_STAGE_LABELS[s]} />
              ))}
            </div>
            <Checkbox className="mt-3" name="noWebsiteOnly" label="Only companies without a website" />
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={!usable.length}>
              Create campaign
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function CampaignControls({ id, status }: { id: string; status: string }) {
  const { pending, submit } = useSubmit();
  const [limit, setLimit] = useState(25);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-sm text-ink-600">
        Drafts
        <Input type="number" min={1} max={100} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="h-8 w-20" aria-label="Number of drafts" />
      </label>
      <Button size="sm" loading={pending} disabled={status !== "ACTIVE" && status !== "DRAFT"} onClick={() => void submit(async () => {
        const r = await apiFetch<{ created: number; skippedSuppressed: number; skippedOther: number }>(`/api/campaigns/${id}`, { body: { limit } });
        return r;
      }, "Drafts generated — review them in the Email Queue after submitting")}>
        <Sparkles className="h-4 w-4" aria-hidden /> Generate drafts
      </Button>
      <Button size="sm" variant="outline" onClick={() => void submit(() => apiFetch(`/api/campaigns/${id}`, { method: "PATCH", body: { status: status === "ACTIVE" ? "PAUSED" : "ACTIVE" } }), status === "ACTIVE" ? "Campaign paused" : "Campaign activated")}>
        {status === "ACTIVE" ? "Pause" : "Activate"}
      </Button>
    </div>
  );
}

export function TemplateEditor({ template }: { template?: { _id: string; name: string; subject: string; body: string; countryCode: string; languageCode: string; industry?: string; serviceCategory?: string; active: boolean } }) {
  const { pending, errors, error, submit, router } = useSubmit();
  const [body, setBody] = useState(template?.body ?? "Hi {{contactName|there}},\n\n…\n\nBest regards,\n{{senderName}}");
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: fd.get("name"),
      subject: fd.get("subject"),
      body,
      countryCode: fd.get("countryCode"),
      languageCode: fd.get("languageCode"),
      industry: fd.get("industry"),
      serviceCategory: fd.get("serviceCategory"),
      active: fd.get("active") === "on",
    };
    void submit(() => (template ? apiFetch(`/api/outreach/templates/${template._id}`, { method: "PATCH", body: payload }) : apiFetch<{ _id: string }>("/api/outreach/templates", { body: payload })), "Template saved").then(() => router.push("/dashboard/outreach/templates"));
  }
  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Name" error={errors.name}>
          {(p) => <Input {...p} name="name" defaultValue={template?.name} required />}
        </Field>
        <Field label="Subject" error={errors.subject}>
          {(p) => <Input {...p} name="subject" defaultValue={template?.subject} required />}
        </Field>
        <Field label="Body" error={errors.body} hint="Plain text. Use {{variable}} or {{variable|neutral fallback}}. Missing facts are left empty and flagged to the reviewer — never invented.">
          {(p) => <Textarea {...p} rows={16} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono text-[13px]" />}
        </Field>
      </div>
      <div className="space-y-4">
        <Field label="Country" error={errors.countryCode}>
          {(p) => (
            <Select {...p} name="countryCode" defaultValue={template?.countryCode ?? "INTL"}>
              <option value="INTL">International (any country)</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Language" error={errors.languageCode}>
          {(p) => (
            <Select {...p} name="languageCode" defaultValue={template?.languageCode ?? "en"}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.englishName}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Industry" optional="optional">
          {(p) => (
            <Select {...p} name="industry" defaultValue={template?.industry ?? ""}>
              <option value="">Any</option>
              {INDUSTRIES.map((i) => (
                <option key={i} value={i}>
                  {INDUSTRY_LABELS[i]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Service category" optional="optional">
          {(p) => (
            <Select {...p} name="serviceCategory" defaultValue={template?.serviceCategory ?? ""}>
              <option value="">Any</option>
              {SERVICE_CATEGORIES.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.slug.replace(/-/g, " ")}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Checkbox name="active" defaultChecked={template?.active ?? true} label="Active" />
        <div className="rounded-xl border border-ink-200 bg-ink-50 p-3">
          <p className="text-xs font-medium text-ink-600">Insert variable</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {TEMPLATE_VARIABLES.filter((v) => v !== "unsubscribeUrl").map((v) => (
              <button key={v} type="button" onClick={() => setBody((b) => `${b}{{${v}}}`)} className="rounded-md bg-white px-2 py-1 font-mono text-[11px] text-ink-700 ring-1 ring-ink-200 hover:bg-brand-50">
                {`{{${v}}}`}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-ink-500">An unsubscribe footer is always appended at send time.</p>
        </div>
        <Button type="submit" className="w-full" loading={pending}>
          Save template
        </Button>
        {template && (
          <Button
            variant="ghost"
            className="w-full text-red-600 hover:bg-red-50"
            onClick={() => {
              if (confirm("Delete this template?")) void submit(() => apiFetch(`/api/outreach/templates/${template._id}`, { method: "DELETE" }), "Template deleted").then((r) => r && router.push("/dashboard/outreach/templates"));
            }}
          >
            <Trash2 className="h-4 w-4" aria-hidden /> Delete
          </Button>
        )}
      </div>
    </form>
  );
}

/** Review workflow controls on a single outreach message. */
export function MessageReview({ id, status, replyStatus, editable, subject, body, canApprove }: { id: string; status: string; replyStatus: string; editable: boolean; subject: string; body: string; canApprove: boolean }) {
  const { pending, error, submit } = useSubmit();
  const [s, setS] = useState(subject);
  const [b, setB] = useState(body);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const act = (action: string, success: string, payload?: object) => submit(() => apiFetch(`/api/outreach/messages/${id}/${action}`, { body: payload ?? {} }), success);
  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      {editable ? (
        <>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Subject</span>
            <Input value={s} onChange={(e) => setS(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Body</span>
            <Textarea value={b} onChange={(e) => setB(e.target.value)} rows={14} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" loading={pending} onClick={() => void submit(() => apiFetch(`/api/outreach/messages/${id}`, { method: "PATCH", body: { subject: s, body: b } }), "Draft saved")}>
              Save draft
            </Button>
            <Button loading={pending} onClick={() => void submit(async () => {
              await apiFetch(`/api/outreach/messages/${id}`, { method: "PATCH", body: { subject: s, body: b } });
              await apiFetch(`/api/outreach/messages/${id}/submit`, { body: {} });
            }, "Submitted for review")}>
              Submit for review
            </Button>
          </div>
        </>
      ) : null}
      {status === "PENDING_APPROVAL" && canApprove && (
        <div className="flex flex-wrap gap-2">
          <Button loading={pending} onClick={() => void act("approve", "Approved — ready to send")}>
            Approve
          </Button>
          <Button variant="outline" onClick={() => setRejecting(true)}>
            Return for changes
          </Button>
        </div>
      )}
      {status === "APPROVED" && canApprove && (
        <Button loading={pending} onClick={() => void act("send", "Sent")}>
          <Send className="h-4 w-4" aria-hidden /> Send now
        </Button>
      )}
      {["SENT", "DELIVERED"].includes(status) && replyStatus !== "REPLIED" && (
        <Button variant="outline" loading={pending} onClick={() => void act("replied", "Reply recorded — lead moved to Replied")}>
          Record reply
        </Button>
      )}
      <Modal open={rejecting} onClose={() => setRejecting(false)} title="Return for changes" size="sm">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What should be changed?" rows={4} aria-label="Reason" />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRejecting(false)}>
            Cancel
          </Button>
          <Button loading={pending} disabled={reason.trim().length < 2} onClick={() => void act("reject", "Returned to author", { reason }).then(() => setRejecting(false))}>
            Return draft
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export function SuppressionForm() {
  const { pending, errors, error, submit } = useSubmit();
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const value = String(fd.get("value") ?? "").trim();
    const isEmail = value.includes("@");
    void submit(() => apiFetch("/api/outreach/suppression", { body: { [isEmail ? "email" : "domain"]: value, reason: fd.get("reason"), note: fd.get("note") || undefined } }), "Added to suppression list").then(() => form.reset());
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 p-5 md:flex-row md:items-end">
      {error && <Alert tone="danger" className="md:hidden">{error}</Alert>}
      <Field label="Email or domain" className="md:flex-1" error={errors.email ?? errors.domain ?? (error ? [error] : undefined)}>
        {(p) => <Input {...p} name="value" required placeholder="name@company.com or company.com" />}
      </Field>
      <Field label="Reason" className="md:w-48">
        {(p) => (
          <Select {...p} name="reason" defaultValue="MANUAL">
            {SUPPRESSION_REASONS.map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, " ").toLowerCase()}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Note" optional="optional" className="md:w-64">
        {(p) => <Input {...p} name="note" />}
      </Field>
      <Button type="submit" loading={pending}>
        <ShieldBan className="h-4 w-4" aria-hidden /> Suppress
      </Button>
    </form>
  );
}

export function RemoveSuppression({ id }: { id: string }) {
  const { pending, submit } = useSubmit();
  return (
    <Button size="xs" variant="ghost" loading={pending} onClick={() => confirm("Remove this entry? The address could receive outreach again.") && void submit(() => apiFetch(`/api/outreach/suppression/${id}`, { method: "DELETE" }), "Removed")}>
      Remove
    </Button>
  );
}
