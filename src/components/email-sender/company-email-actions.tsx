"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Eye, PenLine, Send } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { CompanyRow } from "@/components/intel/types";
import { EMAIL_RE, isDraftValid, MessageEditor, newSendKey, type DefaultTemplate, type Draft } from "./message-editor";
import { TemplatePickers, type TemplateOption } from "./email-sender";

/** Passed only to the Owner (decided on the server); every send is re-checked by the API and the service. */
export type CompanyEmailContext = { template: DefaultTemplate; configured: boolean; problems: string[]; from: string; fromName: string; options?: TemplateOption[] };

type Rendered = { subject: string; html: string; text: string };
type SendResponse = { provider: string; duplicate?: boolean; company?: { stage: string; lastContactedAt: string } };
type CompanyTemplate = DefaultTemplate & { templateId: string; locale: string; suggestion: { templateId: string; locale: string; reason: string }; reminder: { allowed: boolean; reason: string } };

const SEND_URL = "/api/email-sender/send";
const PREVIEW_URL = "/api/email-sender/preview";
const TEMPLATE_URL = "/api/email-sender/template";

/**
 * The personalised template for this company, rendered by the server from the company record.
 * The first load returns the suggestion; changing template or language re-fetches.
 */
function useCompanyTemplate(companyId: string) {
  const [choice, setChoice] = useState<{ templateId?: string; locale?: string }>({});
  const [data, setData] = useState<CompanyTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(choice);
  useEffect(() => {
    let live = true;
    apiFetch<CompanyTemplate>(TEMPLATE_URL, { body: { companyId, ...JSON.parse(key) } })
      .then((r) => {
        if (!live) return;
        setData(r);
        setError(null);
      })
      .catch((e) => live && setError(e instanceof ApiError ? e.message : "Template unavailable"));
    return () => {
      live = false;
    };
  }, [companyId, key]);
  return { data, error, choose: (p: { templateId?: string; locale?: string }) => setChoice((c) => ({ templateId: data?.templateId, locale: data?.locale, ...c, ...p })) };
}

function lastContactedLabel(iso?: string) {
  if (!iso) return null;
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Emailed today";
  return `Last contacted ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" })}`;
}

/** Why sending is unavailable for this row, or null. Mirrors the server's guards so the buttons are honest. */
function blockedReason(row: CompanyRow, ctx: CompanyEmailContext) {
  if (!row.email || !EMAIL_RE.test(row.email.trim())) return "No valid email address for this company";
  if (row.isDemo) return "Demo company — contact details are not real";
  if (row.marketingProtected) return "The registry marks this company as protected from marketing";
  if (row.stage === "DO_NOT_CONTACT") return "Marked Do not contact";
  if (!ctx.configured) return "Email delivery is not set up yet — see Email Sender";
  return null;
}

/**
 * One request at a time, de-duplicated server-side by the idempotency key: a double click or
 * a retry after a slow response never sends twice. A network error keeps the key (so a retry
 * is recognised); a finished attempt gets a fresh one.
 */
function useSend(row: CompanyRow, onSent: (p: Partial<CompanyRow>) => void) {
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const keyRef = useRef(newSendKey());

  async function send(payload: Record<string, unknown>) {
    if (inFlight.current) return false;
    inFlight.current = true;
    setSending(true);
    setError(null);
    try {
      const r = await apiFetch<SendResponse>(SEND_URL, { body: { ...payload, companyId: row.id, idempotencyKey: keyRef.current } });
      keyRef.current = newSendKey();
      if (r.company) onSent({ stage: r.company.stage, lastContactedAt: r.company.lastContactedAt });
      toast.success(r.duplicate ? `Already sent to ${String(payload.to)}` : `Email to ${String(payload.to)} accepted for delivery`);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status !== 0) keyRef.current = newSendKey();
      setError(e instanceof ApiError ? e.message : "Something went wrong — the email may not have been sent. Try again: a repeated request never sends twice.");
      return false;
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }
  return { send, sending, error, setError, resetKey: () => (keyRef.current = newSendKey()) };
}

function PreviewFrame({ payload }: { payload: Record<string, unknown> }) {
  const [preview, setPreview] = useState<Rendered | null>(null);
  const [error, setError] = useState<string | null>(null);
  const body = JSON.stringify(payload);
  useEffect(() => {
    let live = true;
    apiFetch<Rendered>(PREVIEW_URL, { body: JSON.parse(body) })
      .then((r) => {
        if (!live) return;
        setPreview(r);
        setError(null);
      })
      .catch((e) => {
        if (live) setError(e instanceof ApiError ? e.message : "Preview unavailable");
      });
    return () => {
      live = false;
    };
  }, [body]);
  if (error) return <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{error}</p>;
  if (!preview) return <p className="py-10 text-center text-xs text-ink-500">Loading preview…</p>;
  // sandbox="" → no scripts, no forms, no same-origin access
  return <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-[460px] w-full rounded-lg border border-ink-200 bg-white" />;
}

const btn = "inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

/** Owner-only email actions beside a company's email: Quick Send (default template) and Custom email. */
export function CompanyEmailActions({ row, ctx, onSent }: { row: CompanyRow; ctx: CompanyEmailContext; onSent: (p: Partial<CompanyRow>) => void }) {
  const [quickOpen, setQuickOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const blocked = blockedReason(row, ctx);
  const last = lastContactedLabel(row.lastContactedAt);
  const name = row.name;

  const markSent = (p: Partial<CompanyRow>) => {
    onSent(p);
    setJustSent(true);
    setTimeout(() => setJustSent(false), 4000);
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setQuickOpen(true);
        }}
        disabled={!!blocked}
        title={blocked ?? `Send a personalised template email to ${row.email}`}
        aria-label={`Quick send a template email to ${row.email ?? name}`}
        className={cn(btn, justSent ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-brand-200 bg-brand-50 text-brand-700 hover:border-brand-300 hover:bg-brand-100")}
      >
        {justSent ? <Check className="h-3 w-3" aria-hidden /> : <Send className="h-3 w-3" aria-hidden />}
        <span aria-live="polite">{justSent ? "Sent" : "Quick send"}</span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setCustomOpen(true);
        }}
        disabled={!!blocked}
        title={blocked ?? `Write a custom email to ${row.email}`}
        aria-label={`Write a custom email to ${row.email ?? name}`}
        className={cn(btn, "border-ink-200 bg-white text-ink-600 hover:border-brand-300 hover:text-brand-700")}
      >
        <PenLine className="h-3 w-3" aria-hidden /> Custom
      </button>
      {last && <span className="basis-full text-[11px] font-medium text-emerald-700">{last}</span>}

      {quickOpen && <QuickSendDialog row={row} ctx={ctx} onClose={() => setQuickOpen(false)} onSent={markSent} />}
      {customOpen && <CustomEmailDialog row={row} ctx={ctx} onClose={() => setCustomOpen(false)} onSent={markSent} />}
    </>
  );
}

function QuickSendDialog({ row, ctx, onClose, onSent }: { row: CompanyRow; ctx: CompanyEmailContext; onClose: () => void; onSent: (p: Partial<CompanyRow>) => void }) {
  const to = row.email!.trim();
  const { send, sending, error } = useSend(row, onSent);
  const [showPreview, setShowPreview] = useState(false);
  const tpl = useCompanyTemplate(row.id);
  const t = tpl.data;
  const reminderBlocked = t?.templateId === "reminder" && !t.reminder.allowed;

  async function submit() {
    if (!t || reminderBlocked) return;
    if (await send({ mode: "TEMPLATE", to, templateId: t.templateId, locale: t.locale })) onClose();
  }

  return (
    <Modal
      open
      onClose={() => !sending && onClose()}
      title="Send the template email?"
      description="Personalised with this company's registry data. Sent emails cannot be recalled."
      size={showPreview ? "lg" : "md"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={sending} disabled={!t || reminderBlocked}>
            {!sending && <Send className="h-4 w-4" aria-hidden />} {sending ? "Sending…" : "Send"}
          </Button>
        </>
      }
    >
      {t && ctx.options && (
        <div className="mb-4 space-y-2">
          <TemplatePickers idPrefix={`qs-${row.id}`} templateId={t.templateId} locale={t.locale} options={ctx.options} onTemplate={(v) => tpl.choose({ templateId: v })} onLocale={(v) => tpl.choose({ locale: v })} />
          <p className="text-xs text-ink-500">
            Suggested: <span className="font-medium text-ink-700">{ctx.options.find((o) => o.id === t.suggestion.templateId)?.label}</span> — {t.suggestion.reason}
          </p>
          {reminderBlocked && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{t.reminder.reason}</p>}
        </div>
      )}
      {tpl.error && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{tpl.error}</p>}
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-xs text-ink-500">To</dt>
          <dd className="break-all font-medium text-ink-900">{to}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-500">Company</dt>
          <dd className="text-ink-800">{row.name}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-500">Subject</dt>
          <dd className="text-ink-800">{t?.subject ?? "Loading…"}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-500">From</dt>
          <dd className="text-ink-800">
            {ctx.fromName} &lt;{ctx.from}&gt;
          </dd>
        </div>
      </dl>
      {row.lastContactedAt && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{lastContactedLabel(row.lastContactedAt)} — check this is not a repeat before sending.</p>}
      <button type="button" onClick={() => setShowPreview((v) => !v)} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline" aria-expanded={showPreview}>
        <Eye className="h-3.5 w-3.5" aria-hidden /> {showPreview ? "Hide preview" : "Preview the email"}
      </button>
      {showPreview && t && (
        <div className="mt-2">
          <PreviewFrame payload={{ mode: "TEMPLATE", to, companyId: row.id, templateId: t.templateId, locale: t.locale }} />
        </div>
      )}
      {error && (
        <Alert tone="danger" title="Not sent" className="mt-3">
          {error}
        </Alert>
      )}
    </Modal>
  );
}

function CustomEmailDialog({ row, ctx, onClose, onSent }: { row: CompanyRow; ctx: CompanyEmailContext; onClose: () => void; onSent: (p: Partial<CompanyRow>) => void }) {
  const { send, sending, error, setError, resetKey } = useSend(row, onSent);
  const [to, setTo] = useState(row.email?.trim() ?? "");
  const [draft, setDraft] = useState<Draft>({ subject: "", body: "", includeCta: false });
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const tpl = useCompanyTemplate(row.id);
  const locale = tpl.data?.locale ?? "en";
  const toValid = EMAIL_RE.test(to.trim());
  const valid = toValid && isDraftValid(draft);
  const dirty = !!(draft.subject || draft.body);

  // Any change to the email is a new send request.
  useEffect(() => {
    resetKey();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resetKey only writes a ref
  }, [to, draft]);

  function close() {
    if (sending) return;
    if (dirty && !window.confirm("Discard this email?")) return;
    onClose();
  }

  async function submit() {
    if (!valid) return;
    if (await send({ mode: "CUSTOM", to: to.trim(), ...draft, locale })) onClose();
  }

  const context: [string, string | undefined][] = [
    ["Company", row.name],
    ["Contact person", row.contactPerson ? `${row.contactPerson.name}${row.contactPerson.role ? ` · ${row.contactPerson.role}` : ""}` : undefined],
    ["Industry", row.industryLabel],
    ["Country", row.countryCode],
    ["Location", [row.city, row.region].filter((x, i, a) => x && a.indexOf(x) === i).join(", ") || undefined],
    ["Website", row.website],
  ];

  return (
    <Modal
      open
      onClose={close}
      title="Send email"
      description={`Custom email to ${row.name}`}
      size="lg"
      footer={
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-500">
            From {ctx.fromName} &lt;{ctx.from}&gt;
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close} disabled={sending}>
              Cancel
            </Button>
            <Button onClick={submit} loading={sending} disabled={!valid}>
              {!sending && <Send className="h-4 w-4" aria-hidden />} {sending ? "Sending…" : "Send email"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <details className="rounded-xl border border-ink-200 bg-ink-50/60 px-4 py-2.5 text-sm">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-ink-500">Company details (from Company Intelligence)</summary>
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {context.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-[11px] text-ink-500">{k}</dt>
                <dd className={cn("break-words", v ? "text-ink-900" : "italic text-ink-400")}>{v ?? "Not available"}</dd>
              </div>
            ))}
          </dl>
        </details>

        <div>
          <label htmlFor={`ce-to-${row.id}`} className="mb-1.5 block text-sm font-medium text-ink-800">
            Recipient
          </label>
          <Input id={`ce-to-${row.id}`} type="email" inputMode="email" autoComplete="off" value={to} onChange={(e) => {
              setTo(e.target.value);
              setError(null);
            }} aria-invalid={to && !toValid ? true : undefined} />
          {to && !toValid && <p className="mt-1 text-xs font-medium text-red-600">Enter a valid email address.</p>}
        </div>

        <div role="tablist" aria-label="Compose or preview" className="grid grid-cols-2 gap-1 rounded-xl bg-ink-100 p-1">
          {(["edit", "preview"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("rounded-lg px-3 py-1.5 text-sm font-medium transition-colors", tab === t ? "bg-white text-ink-900 shadow-soft" : "text-ink-600 hover:text-ink-900")}>
              {t === "edit" ? "Write" : "Preview"}
            </button>
          ))}
        </div>

        {tpl.data && ctx.options && (
          <TemplatePickers
            idPrefix={`ce-${row.id}`}
            templateId={tpl.data.templateId}
            locale={tpl.data.locale}
            options={ctx.options.filter((o) => o.id !== "reminder")}
            onTemplate={(v) => tpl.choose({ templateId: v })}
            onLocale={(v) => tpl.choose({ locale: v })}
          />
        )}

        {tab === "edit" ? (
          <MessageEditor idPrefix={`ce-${row.id}`} draft={draft} onChange={setDraft} template={tpl.data ?? ctx.template} bodyClassName="min-h-60 font-mono text-[13px]" />
        ) : isDraftValid(draft) ? (
          <PreviewFrame payload={{ mode: "CUSTOM", to: toValid ? to.trim() : undefined, ...draft, locale }} />
        ) : (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">The preview is available once the subject has at least 3 characters and the message at least 10.</p>
        )}

        {error && (
          <Alert tone="danger" title="Not sent">
            {error}
          </Alert>
        )}
      </div>
    </Modal>
  );
}
