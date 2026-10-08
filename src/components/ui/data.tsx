import Link from "next/link";
import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { cn, initials } from "@/lib/utils";
import { formatNumber } from "@/lib/utils/format";

/* ───────────── Table ───────────── */

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("scroll-thin overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-sm">{children}</table>
    </div>
  );
}
export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-ink-50/70 text-xs uppercase tracking-wide text-ink-500">{children}</thead>;
}
export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}
export function TH({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={cn("whitespace-nowrap border-b border-ink-200 px-4 py-2.5 font-medium first:pl-5 last:pr-5", className)} {...props} />;
}
export function TD({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-ink-100 px-4 py-3 align-middle text-ink-700 first:pl-5 last:pr-5", className)} {...props} />;
}
export function TR({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cn("transition-colors hover:bg-ink-50/60", className)}>{children}</tr>;
}

/* ───────────── Pagination (URL based, works without JS) ───────────── */

export function Pagination({ page, pageCount, total, buildHref }: { page: number; pageCount: number; total: number; buildHref: (page: number) => string }) {
  if (pageCount <= 1) return <p className="px-5 py-3 text-xs text-ink-500">{formatNumber(total)} result{total === 1 ? "" : "s"}</p>;
  const link = "inline-flex h-8 items-center gap-1 rounded-lg border border-ink-200 bg-white px-2.5 text-sm text-ink-700 hover:bg-ink-50";
  return (
    <nav className="flex items-center justify-between gap-3 px-5 py-3" aria-label="Pagination">
      <p className="text-xs text-ink-500">
        Page {page} of {pageCount} · {formatNumber(total)} results
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link className={link} href={buildHref(page - 1)} rel="prev">
            <ChevronLeft className="h-4 w-4" /> Prev
          </Link>
        ) : (
          <span className={cn(link, "pointer-events-none opacity-40")} aria-disabled>
            <ChevronLeft className="h-4 w-4" /> Prev
          </span>
        )}
        {page < pageCount ? (
          <Link className={link} href={buildHref(page + 1)} rel="next">
            Next <ChevronRight className="h-4 w-4" />
          </Link>
        ) : (
          <span className={cn(link, "pointer-events-none opacity-40")} aria-disabled>
            Next <ChevronRight className="h-4 w-4" />
          </span>
        )}
      </div>
    </nav>
  );
}

/** Build a URL preserving current search params. */
export function withParams(path: string, current: Record<string, string | string[] | undefined>, changes: Record<string, string | number | undefined | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) if (typeof v === "string" && v) p.set(k, v);
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined || v === null || v === "") p.delete(k);
    else p.set(k, String(v));
  }
  const qs = p.toString();
  return qs ? `${path}?${qs}` : path;
}

/* ───────────── Link tabs ───────────── */

export function LinkTabs({ tabs, active }: { tabs: { href: string; label: ReactNode; id: string; count?: number }[]; active: string }) {
  return (
    <nav className="scroll-thin -mb-px flex gap-1 overflow-x-auto border-b border-ink-200" aria-label="Sections">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          aria-current={active === t.id ? "page" : undefined}
          className={cn("-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors", active === t.id ? "border-brand-600 text-brand-700" : "border-transparent text-ink-500 hover:text-ink-800")}
        >
          {t.label}
          {t.count !== undefined && <span className="rounded-full bg-ink-100 px-1.5 text-xs text-ink-600">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/* ───────────── KPI card ───────────── */

export function KpiCard({ label, value, hint, icon: Icon, href, tone = "neutral" }: { label: string; value: number | string; hint?: ReactNode; icon?: LucideIcon; href?: string; tone?: "neutral" | "brand" | "success" | "warning" }) {
  const toneCls = { neutral: "bg-ink-50 text-ink-500", brand: "bg-brand-50 text-brand-600", success: "bg-emerald-50 text-emerald-600", warning: "bg-amber-50 text-amber-600" }[tone];
  const body = (
    <div className="flex h-full flex-col justify-between gap-3 rounded-2xl border border-ink-200/80 bg-white p-4 shadow-card transition-shadow hover:shadow-lifted sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
        {Icon && (
          <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", toneCls)}>
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        )}
      </div>
      <div>
        <p className="text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">{typeof value === "number" ? formatNumber(value) : value}</p>
        {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-2xl">
      {body}
    </Link>
  ) : (
    body
  );
}

/* ───────────── Misc ───────────── */

export function Avatar({ name, className }: { name?: string | null; className?: string }) {
  return (
    <span className={cn("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800", className)} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-xs font-medium text-ink-500">{eyebrow}</div>}
        <h1 className="text-xl font-semibold tracking-tight text-ink-900 sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ScorePill({ score, threshold = 60 }: { score: number; threshold?: number }) {
  const cls = score >= threshold ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : score >= threshold - 20 ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-ink-100 text-ink-600 ring-ink-200";
  return <span className={cn("inline-flex min-w-9 justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ring-1 ring-inset", cls)}>{score}</span>;
}

export function DescriptionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-xs font-medium text-ink-500">{i.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-ink-900">{i.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
