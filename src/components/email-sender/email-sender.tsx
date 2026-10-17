"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileText, Monitor, PenLine, Send, Smartphone } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { EMAIL_RE, isDraftValid, MessageEditor, newSendKey as newKey, type DefaultTemplate } from "./message-editor";

type Mode = "TEMPLATE" | "CUSTOM";
type Rendered = { subject: string; html: string; text: string };
type Status = { configured: boolean; provider: string; from: string; fromName: string; replyTo: string; problems: string[]; limits: { hourly: number; daily: number; cooldownMinutes: number } };


/**
 * Owner-only Email Sender composer. Everything is rendered and sent by the server:
 * the preview shows the exact email, in a sandboxed iframe (no scripts, no same-origin).
 */
export function EmailSender({ status, initialPreview, template }: { status: Status; initialPreview: Rendered; template: DefaultTemplate }) {
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("TEMPLATE");
  const [to, setTo] = useState("");
  const [touchedTo, setTouchedTo] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [includeCta, setIncludeCta] = useState(false);
  const [preview, setPreview] = useState<Rendered>(initialPreview);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const keyRef = useRef(newKey());

  const toValid = EMAIL_RE.test(to.trim());
  const customValid = isDraftValid({ subject, body, includeCta });
  const canSend = status.configured && toValid && (mode === "TEMPLATE" || customValid) && !sending;
  // Template mode without a recipient shows the server-rendered default; incomplete custom drafts show a hint.
  const shown = mode === "TEMPLATE" && !to ? initialPreview : preview;
  const draftHint = mode === "CUSTOM" && !customValid && (subject || body) ? "The preview updates when the subject has at least 3 characters and the message at least 10." : null;
  const notice = draftHint ?? previewError;

  // Live preview (debounced) from the same server renderer that sends the email.
  useEffect(() => {
    if ((mode === "TEMPLATE" && !to) || (mode === "CUSTOM" && !customValid)) return;
    const t = setTimeout(() => {
      const payload = mode === "TEMPLATE" ? { mode, to } : { mode, to, subject, body, includeCta };
      apiFetch<Rendered>("/api/email-sender/preview", { body: payload })
        .then((r) => {
          setPreview(r);
          setPreviewError(null);
        })
        .catch((e) => setPreviewError(e instanceof ApiError ? e.message : "Preview unavailable"));
    }, 350);
    return () => clearTimeout(t);
  }, [mode, to, subject, body, includeCta, customValid]);

  // Any change to the email starts a new send request key.
  useEffect(() => {
    keyRef.current = newKey();
  }, [mode, to, subject, body, includeCta]);

  async function send() {
    setSending(true);
    setResult(null);
    const payload = mode === "TEMPLATE" ? { mode, to: to.trim(), idempotencyKey: keyRef.current } : { mode, to: to.trim(), subject, body, includeCta, idempotencyKey: keyRef.current };
    try {
      const r = await apiFetch<{ provider: string; duplicate?: boolean }>("/api/email-sender/send", { body: payload });
      setResult({ ok: true, message: `${r.duplicate ? "Already sent — " : ""}Accepted by ${r.provider} for delivery to ${to.trim()}. Final delivery is not confirmed by the provider here.` });
      toast.success("Email accepted by the provider");
      keyRef.current = newKey();
      setConfirmOpen(false);
      setTo("");
      setTouchedTo(false);
      router.refresh();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Network error — the email may not have been sent. Try again: a repeated request never sends twice.";
      // A finished attempt (rejected / blocked) needs a fresh key; a network error keeps it so a retry is de-duplicated.
      if (e instanceof ApiError && e.status !== 0) keyRef.current = newKey();
      setResult({ ok: false, message });
      setConfirmOpen(false);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-5">
      {!status.configured && (
        <Alert tone="warning" title="Sending is not available yet">
          <ul className="list-disc space-y-1 pl-4">
            {status.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        {/* Composer */}
        <section aria-label="Compose" className="space-y-5 rounded-2xl border border-ink-200 bg-white p-5 shadow-soft sm:p-6">
          <div role="tablist" aria-label="Email type" className="grid grid-cols-2 gap-1 rounded-xl bg-ink-100 p-1">
            {(
              [
                ["TEMPLATE", "Fixed template", FileText],
                ["CUSTOM", "Custom email", PenLine],
              ] as const
            ).map(([m, label, Icon]) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => {
                  setMode(m);
                  setResult(null);
                }}
                className={cn("inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors", mode === m ? "bg-white text-ink-900 shadow-soft" : "text-ink-600 hover:text-ink-900")}
              >
                <Icon className="h-4 w-4" aria-hidden /> {label}
              </button>
            ))}
          </div>

          <div>
            <label htmlFor="es-to" className="mb-1.5 block text-sm font-medium text-ink-800">
              Recipient email
            </label>
            <Input id="es-to" type="email" inputMode="email" autoComplete="off" placeholder="name@company.com" value={to} onChange={(e) => setTo(e.target.value)} onBlur={() => setTouchedTo(true)} aria-invalid={touchedTo && !!to && !toValid ? true : undefined} aria-describedby="es-to-hint" />
            <p id="es-to-hint" className={cn("mt-1.5 text-xs", touchedTo && to && !toValid ? "font-medium text-red-600" : "text-ink-500")}>
              {touchedTo && to && !toValid ? "Enter a valid email address." : "One recipient per email. Addresses on the suppression list are blocked automatically."}
            </p>
          </div>

          {mode === "TEMPLATE" ? (
            <div className="rounded-xl border border-ink-200 bg-ink-50/60 p-4 text-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Subject</p>
              <p className="mt-0.5 font-medium text-ink-900">{initialPreview.subject}</p>
              <p className="mt-3 text-ink-600">An introduction to ExploreTechify’s approach (websites that turn visitors into customers) in the branded layout, with one “See How We Can Help” button, your sender name and contact details, and a one-line opt-out. Review it in the preview, enter the recipient and send.</p>
            </div>
          ) : (
            <MessageEditor
              idPrefix="es"
              draft={{ subject, body, includeCta }}
              onChange={(d) => {
                setSubject(d.subject);
                setBody(d.body);
                setIncludeCta(d.includeCta);
              }}
              template={template}
            />
          )}

          {result && (
            <Alert tone={result.ok ? "success" : "danger"} title={result.ok ? "Accepted by the provider" : "Not sent"}>
              {result.message}
            </Alert>
          )}

          <div className="flex flex-col gap-2 border-t border-ink-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-ink-500">
              From {status.fromName} &lt;{status.from}&gt; · replies to {status.replyTo}
            </p>
            <Button size="lg" disabled={!canSend} onClick={() => setConfirmOpen(true)} className="w-full sm:w-auto">
              <Send className="h-4 w-4" aria-hidden /> Send email
            </Button>
          </div>
        </section>

        {/* Preview */}
        <section aria-label="Preview" className="min-w-0 rounded-2xl border border-ink-200 bg-white shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-5 py-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Preview — exactly what will be sent</p>
              <p className="truncate text-sm font-medium text-ink-900">{shown.subject}</p>
            </div>
            <div className="flex rounded-lg border border-ink-200 p-0.5" role="group" aria-label="Preview size">
              <button type="button" onClick={() => setDevice("desktop")} aria-pressed={device === "desktop"} className={cn("rounded-md p-1.5", device === "desktop" ? "bg-ink-900 text-white" : "text-ink-500 hover:text-ink-900")} aria-label="Desktop preview">
                <Monitor className="h-4 w-4" aria-hidden />
              </button>
              <button type="button" onClick={() => setDevice("mobile")} aria-pressed={device === "mobile"} className={cn("rounded-md p-1.5", device === "mobile" ? "bg-ink-900 text-white" : "text-ink-500 hover:text-ink-900")} aria-label="Mobile preview">
                <Smartphone className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
          {notice && <p className="border-b border-ink-100 bg-amber-50 px-5 py-2 text-xs text-amber-900">{notice}</p>}
          <div className="flex justify-center bg-ink-100/70 p-3 sm:p-5">
            {/* sandbox="" → no scripts, no forms, no same-origin access */}
            <iframe title="Email preview" sandbox="" srcDoc={shown.html} className={cn("h-[680px] rounded-xl border border-ink-200 bg-white transition-[width] duration-200", device === "mobile" ? "w-[375px] max-w-full" : "w-full")} />
          </div>
          <details className="border-t border-ink-100 px-5 py-3">
            <summary className="cursor-pointer text-sm font-medium text-ink-700">Plain-text version</summary>
            <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-ink-50 p-3 text-xs text-ink-700">{shown.text}</pre>
          </details>
        </section>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => !sending && setConfirmOpen(false)}
        title="Send this email?"
        description="Check the recipient — sent emails cannot be recalled."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={sending}>
              Cancel
            </Button>
            <Button onClick={send} loading={sending}>
              <Send className="h-4 w-4" aria-hidden /> Send now
            </Button>
          </>
        }
      >
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-xs text-ink-500">To</dt>
            <dd className="font-medium text-ink-900">{to.trim()}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-500">Subject</dt>
            <dd className="text-ink-800">{mode === "TEMPLATE" ? initialPreview.subject : subject}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-500">Type</dt>
            <dd className="flex items-center gap-1.5 text-ink-800">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden /> {mode === "TEMPLATE" ? "Fixed ExploreTechify template" : "Custom email"}
            </dd>
          </div>
        </dl>
      </Modal>
    </div>
  );
}
