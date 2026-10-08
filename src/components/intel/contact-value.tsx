"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Globe2, Mail, MapPin, Phone, Smartphone, User } from "lucide-react";
import { CONTACT_SOURCE_LABELS, displayWebsite, formatPhone, type ContactSourceKind } from "@/lib/company-fields";
import { cn } from "@/lib/utils";

/** Copy-to-clipboard with visible "Copied" confirmation (announced to screen readers). */
export function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Fallback for browsers without async clipboard permission.
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }
  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium transition-colors",
        copied ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-ink-200 bg-white text-ink-600 hover:border-ink-300 hover:text-ink-900",
        className,
      )}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
    >
      {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function ActionLink({ href, children, label, external }: { href: string; children: React.ReactNode; label: string; external?: boolean }) {
  return (
    <a
      href={href}
      onClick={(e) => e.stopPropagation()}
      {...(external && { target: "_blank", rel: "noopener noreferrer nofollow" })}
      aria-label={label}
      className="inline-flex h-6 items-center gap-1 rounded-md border border-ink-200 bg-white px-1.5 text-[11px] font-medium text-ink-600 hover:border-brand-300 hover:text-brand-700"
    >
      {children}
    </a>
  );
}

export type ContactKind = "email" | "phone" | "mobile" | "website" | "address" | "person";

const ICONS = { email: Mail, phone: Phone, mobile: Smartphone, website: Globe2, address: MapPin, person: User } as const;
const LABELS: Record<ContactKind, string> = { email: "Email", phone: "Phone", mobile: "Mobile", website: "Website", address: "Address", person: "Contact person" };

const SHORT_SOURCE: Record<ContactSourceKind, string> = { REGISTRY: "Registry", WEBSITE: "Website", PUBLIC: "Public source", ENRICHMENT: "Enrichment", MANUAL: "Manual" };

export function SourceTag({ kind, source, className }: { kind?: ContactSourceKind; source?: string; className?: string }) {
  if (!kind) return null;
  const tone = kind === "REGISTRY" ? "text-emerald-700" : kind === "MANUAL" ? "text-ink-500" : "text-sky-700";
  return (
    <span className={cn("text-[10px] font-medium uppercase tracking-wide", tone, className)} title={`Source: ${CONTACT_SOURCE_LABELS[kind]}${source ? ` — ${source}` : ""}`}>
      {SHORT_SOURCE[kind]}
    </span>
  );
}

/**
 * One contact value, always shown as readable text with copy + action.
 * Missing values are stated plainly ("Not available from registry") — no icon, no link.
 */
export function ContactValue({
  kind,
  value,
  secondary,
  sourceKind,
  source,
  missing = "Not available from registry",
  disabledActions,
  showLabel,
  className,
}: {
  kind: ContactKind;
  value?: string;
  secondary?: string;
  sourceKind?: ContactSourceKind;
  source?: string;
  missing?: string;
  /** Demo rows: show values but never link out. */
  disabledActions?: boolean;
  showLabel?: boolean;
  className?: string;
}) {
  const Icon = ICONS[kind];
  const label = LABELS[kind];
  if (!value) {
    return (
      <div className={cn("min-w-0", className)}>
        {showLabel && <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</p>}
        <p className="text-xs italic text-ink-400">{missing}</p>
      </div>
    );
  }
  const display = kind === "phone" || kind === "mobile" ? formatPhone(value) : kind === "website" ? displayWebsite(value) : value;
  const copyValue = kind === "website" ? value : kind === "phone" || kind === "mobile" ? value.replace(/\s/g, "") : value;
  return (
    <div className={cn("min-w-0", className)}>
      {showLabel && (
        <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-ink-400">
          {label} <SourceTag kind={sourceKind} source={source} />
        </p>
      )}
      <p className="flex items-start gap-1.5 text-sm text-ink-900">
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden />
        <span className="select-all break-all font-medium">{display}</span>
      </p>
      {secondary && <p className="ml-5 text-xs text-ink-500">{secondary}</p>}
      <div className="ml-5 mt-1 flex flex-wrap items-center gap-1">
        {kind !== "person" && <CopyButton value={copyValue} label={label.toLowerCase()} />}
        {!disabledActions && kind === "email" && (
          <ActionLink href={`mailto:${value}`} label={`Email ${value}`}>
            <Mail className="h-3 w-3" aria-hidden /> Email
          </ActionLink>
        )}
        {!disabledActions && (kind === "phone" || kind === "mobile") && (
          <ActionLink href={`tel:${copyValue}`} label={`Call ${display}`}>
            <Phone className="h-3 w-3" aria-hidden /> Call
          </ActionLink>
        )}
        {!disabledActions && kind === "website" && (
          <ActionLink href={value} external label={`Open ${display} in a new tab`}>
            <ExternalLink className="h-3 w-3" aria-hidden /> Open
          </ActionLink>
        )}
        {!showLabel && <SourceTag kind={sourceKind} source={source} className="ml-0.5" />}
      </div>
    </div>
  );
}
