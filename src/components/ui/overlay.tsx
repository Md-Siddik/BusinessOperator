"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Accessible modal built on <dialog> (focus trap, Esc, backdrop handled natively). */
export function Modal({ open, onClose, title, description, children, footer, size = "md" }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cn(
        "m-auto w-[calc(100%-2rem)] rounded-2xl border border-ink-200 bg-white p-0 text-ink-900 shadow-lifted backdrop:bg-ink-950/40 backdrop:backdrop-blur-[2px]",
        size === "sm" ? "max-w-md" : size === "lg" ? "max-w-3xl" : "max-w-xl",
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-6 py-4">
        <div>
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-ink-100 px-6 py-3">{footer}</div>}
    </dialog>
  );
}

/** Side drawer (mobile navigation, detail panels). */
export function Drawer({ open, onClose, side = "left", label, children, className }: { open: boolean; onClose: () => void; side?: "left" | "right"; label: string; children: ReactNode; className?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={label}>
      <div className="absolute inset-0 animate-fade-in bg-ink-950/40" onClick={onClose} aria-hidden />
      <div className={cn("absolute inset-y-0 flex w-80 max-w-[85vw] flex-col bg-white shadow-lifted", side === "left" ? "left-0" : "right-0", className)}>{children}</div>
    </div>
  );
}

/** Dropdown menu: click to open, Esc / outside click to close, arrow-key friendly items. */
export function Dropdown({ trigger, children, align = "right", className, label }: { trigger: (props: { open: boolean; toggle: () => void; id: string }) => ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right"; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = e.key === "ArrowDown" ? items[(i + 1) % items.length] : items[(i - 1 + items.length) % items.length];
        next?.focus();
        e.preventDefault();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o), id })}
      {open && (
        <div id={id} role="menu" aria-label={label} className={cn("absolute z-40 mt-2 min-w-48 animate-fade-in rounded-xl border border-ink-200 bg-white p-1.5 shadow-lifted", align === "right" ? "right-0" : "left-0", className)}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, onClick, href, active, className }: { children: ReactNode; onClick?: () => void; href?: string; active?: boolean; className?: string }) {
  const cls = cn("flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink-700 hover:bg-ink-50 hover:text-ink-900 focus:bg-ink-50 focus:outline-none", active && "bg-brand-50 font-medium text-brand-700", className);
  if (href) {
    return (
      <a role="menuitem" href={href} className={cls} onClick={onClick} aria-current={active || undefined}>
        {children}
      </a>
    );
  }
  return (
    <button role="menuitem" type="button" className={cls} onClick={onClick}>
      {children}
    </button>
  );
}

export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <span className="group relative inline-flex" aria-describedby={id}>
      {children}
      <span id={id} role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-64 -translate-x-1/2 rounded-md bg-ink-900 px-2 py-1 text-xs text-white opacity-0 shadow-lifted transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        {content}
      </span>
    </span>
  );
}

/** Client-side tabs (for in-page panels). For URL tabs use <LinkTabs>. */
export function Tabs({ tabs, initial, children }: { tabs: { id: string; label: ReactNode }[]; initial?: string; children: (active: string) => ReactNode }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id ?? "");
  return (
    <div>
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-ink-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={active === t.id}
            onClick={() => setActive(t.id)}
            className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors", active === t.id ? "border-brand-600 text-brand-700" : "border-transparent text-ink-500 hover:text-ink-800")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="pt-5">
        {children(active)}
      </div>
    </div>
  );
}
