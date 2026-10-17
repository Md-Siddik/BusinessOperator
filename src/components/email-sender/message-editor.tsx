"use client";

import { useRef } from "react";
import { Bold, Link2, List, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/form";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const LIMITS = { subject: 200, body: 10_000 };
export const newSendKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);

export type DefaultTemplate = { subject: string; body: string; includeCta: boolean };
export type Draft = { subject: string; body: string; includeCta: boolean };

export const isDraftValid = (d: Draft) => d.subject.trim().length >= 3 && d.subject.length <= LIMITS.subject && d.body.trim().length >= 10 && d.body.length <= LIMITS.body;

/**
 * The custom-email editor shared by the Email Sender page and the Company Intelligence
 * composer: subject, plain-text message with the safe markup toolbar, the optional button,
 * and "Start from template", which loads the one default template (never modified here).
 */
export function MessageEditor({ idPrefix, draft, onChange, template, bodyClassName }: { idPrefix: string; draft: Draft; onChange: (d: Draft) => void; template: DefaultTemplate; bodyClassName?: string }) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const { subject, body, includeCta } = draft;
  const set = (p: Partial<Draft>) => onChange({ ...draft, ...p });

  function startFromTemplate() {
    if ((subject || body) && !window.confirm("Replace your current subject and message with the default ExploreTechify template? The saved default template itself is never changed.")) return;
    onChange({ subject: template.subject, body: template.body, includeCta: template.includeCta });
  }

  function wrapSelection(before: string, after = before, placeholder = "text") {
    const el = bodyRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const selected = body.slice(s, e) || placeholder;
    set({ body: body.slice(0, s) + before + selected + after + body.slice(e) });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + before.length, s + before.length + selected.length);
    });
  }

  function insertBullet() {
    const el = bodyRef.current;
    if (!el) return;
    const s = el.selectionStart;
    const lineStart = body.lastIndexOf("\n", s - 1) + 1;
    set({ body: body.slice(0, lineStart) + "- " + body.slice(lineStart) });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + 2, s + 2);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-600">Write a new email or adapt the default template.</p>
        <Button size="sm" variant="outline" onClick={startFromTemplate}>
          <Wand2 className="h-4 w-4" aria-hidden /> Start from template
        </Button>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-subject`} className="mb-1.5 block text-sm font-medium text-ink-800">
          Subject
        </label>
        <Input id={`${idPrefix}-subject`} value={subject} maxLength={LIMITS.subject} onChange={(e) => set({ subject: e.target.value })} placeholder="A clear, honest subject line" />
        <p className="mt-1 text-right text-xs text-ink-400">
          {subject.length}/{LIMITS.subject}
        </p>
      </div>
      <div>
        <div className="mb-1.5 flex items-end justify-between gap-2">
          <label htmlFor={`${idPrefix}-body`} className="text-sm font-medium text-ink-800">
            Message
          </label>
          <div className="flex gap-1" role="toolbar" aria-label="Formatting">
            <button type="button" onClick={() => wrapSelection("**")} className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900" aria-label="Bold" title="Bold (**text**)">
              <Bold className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" onClick={insertBullet} className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900" aria-label="Bullet point" title="Bullet point (- item)">
              <List className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" onClick={() => wrapSelection("", "", "https://exploretechify.com/")} className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900" aria-label="Insert link" title="Links: paste a full https:// address">
              <Link2 className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
        <Textarea
          id={`${idPrefix}-body`}
          ref={bodyRef}
          value={body}
          maxLength={LIMITS.body}
          onChange={(e) => set({ body: e.target.value })}
          className={bodyClassName ?? "min-h-72 font-mono text-[13px]"}
          placeholder={"Hello,\n\nWrite your message here.\n\n- Bullet points start with a dash\n**Bold text** uses double asterisks"}
          aria-describedby={`${idPrefix}-body-hint`}
        />
        <p id={`${idPrefix}-body-hint`} className="mt-1 flex justify-between gap-2 text-xs text-ink-500">
          <span>Plain text: blank line = paragraph, “## ” = heading, “- ” = bullet (“- **Title**: text” on every item = highlight cards, “A → B → C” on its own line = a flow), **bold**, https:// links. HTML is shown as text, never rendered.</span>
          <span className="shrink-0 tabular-nums text-ink-400">
            {body.length.toLocaleString("en-GB")}/{LIMITS.body.toLocaleString("en-GB")}
          </span>
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={includeCta} onChange={(e) => set({ includeCta: e.target.checked })} />
        Add a “See How We Can Help” button linking to the website
      </label>
    </div>
  );
}
