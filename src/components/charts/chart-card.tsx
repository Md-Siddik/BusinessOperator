import type { ReactNode } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { formatNumber, formatPercent } from "@/lib/utils/format";

/** Chart container with title and an accessible (visually hidden) data table. */
export function ChartCard({ title, description, action, children, table }: { title: string; description?: string; action?: ReactNode; children: ReactNode; table?: { columns: string[]; rows: (string | number)[][] } }) {
  return (
    <Card>
      <CardHeader title={title} description={description} action={action} />
      <div className="px-3 pb-4 pt-4 sm:px-5">{children}</div>
      {table && (
        <table className="sr-only">
          <caption>{title}</caption>
          <thead>
            <tr>
              {table.columns.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i}>
                {r.map((v, j) => (
                  <td key={j}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/** Part-of-total meters (better than a pie for independent yes/no availability metrics). */
export function MeterList({ items, total }: { items: { label: string; value: number }[]; total: number }) {
  return (
    <ul className="space-y-4">
      {items.map((i) => {
        const pct = total ? Math.round((i.value / total) * 100) : 0;
        return (
          <li key={i.label}>
            <div className="mb-1.5 flex items-baseline justify-between text-sm">
              <span className="text-ink-700">{i.label}</span>
              <span className="tabular-nums text-ink-900">
                <span className="font-semibold">{formatPercent(i.value, total)}</span>
                <span className="ml-1.5 text-xs text-ink-500">
                  {formatNumber(i.value)} / {formatNumber(total)}
                </span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={i.label}>
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--chart-1)" }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Funnel as decreasing horizontal bars, each labelled with count and conversion from the previous step. */
export function Funnel({ steps }: { steps: { stage: string; count: number }[] }) {
  const max = Math.max(1, ...steps.map((s) => s.count));
  return (
    <ol className="space-y-2.5">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1]!.count : null;
        return (
          <li key={s.stage} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 text-sm">
            <span className="truncate text-ink-600">{s.stage}</span>
            <div className="h-6 overflow-hidden rounded-md bg-ink-50">
              <div className="h-full rounded-md" style={{ width: `${Math.max(2, (s.count / max) * 100)}%`, background: "var(--chart-1)", opacity: 1 - i * 0.08 }} />
            </div>
            <span className="w-24 text-right tabular-nums">
              <span className="font-semibold text-ink-900">{formatNumber(s.count)}</span>
              {prev !== null && <span className="ml-1.5 text-xs text-ink-500">{formatPercent(s.count, prev)}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
