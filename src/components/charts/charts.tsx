"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart as RLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { formatDate, formatNumber } from "@/lib/utils/format";

/** Serializable formatter tokens (functions cannot cross the server → client boundary). */
export type AxisFormat = "shortDate";
const FORMATTERS: Record<AxisFormat, (v: string) => string> = { shortDate: (v) => formatDate(v, "d MMM") };

/** Categorical slots in fixed order (validated palette). Never cycled — >8 series fold into "Other". */
export const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)", "var(--chart-7)", "var(--chart-8)"];
const AXIS = { fontSize: 11, fill: "var(--chart-axis)" };

function ChartTooltip({ active, payload, label, formatLabel }: Partial<TooltipContentProps<number, string>> & { formatLabel?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-xs shadow-lifted">
      <p className="mb-1 font-medium text-ink-900">{formatLabel ? formatLabel(String(label)) : String(label)}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2 text-ink-600">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} aria-hidden />
          {p.name}: <span className="font-semibold text-ink-900 tabular-nums">{formatNumber(Number(p.value))}</span>
        </p>
      ))}
    </div>
  );
}

/** Vertical columns — one series, one hue. */
export function ColumnChart({ data, xKey, yKey, name, height = 220, xFormat }: { data: Record<string, unknown>[]; xKey: string; yKey: string; name: string; height?: number; xFormat?: AxisFormat }) {
  const formatX = xFormat ? FORMATTERS[xFormat] : undefined;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="0" />
        <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--chart-grid)" }} tickFormatter={formatX} minTickGap={12} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
        <Tooltip cursor={{ fill: "rgb(18 23 34 / 0.04)" }} content={<ChartTooltip formatLabel={formatX} />} />
        <Bar dataKey={yKey} name={name} fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bars, sorted — for category magnitude (industries, funnel). */
export function HBarChart({ data, labelKey, valueKey, name, height }: { data: Record<string, unknown>[]; labelKey: string; valueKey: string; name: string; height?: number }) {
  const h = height ?? Math.max(160, data.length * 30 + 20);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 4, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
        <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey={labelKey} tick={{ ...AXIS, fill: "var(--color-ink-600)" }} tickLine={false} axisLine={false} width={128} />
        <Tooltip cursor={{ fill: "rgb(18 23 34 / 0.04)" }} content={<ChartTooltip />} />
        <Bar dataKey={valueKey} name={name} fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Multi-series lines (2px) sharing ONE axis; legend always shown for ≥2 series. */
export function LineChart({ data, xKey, series, height = 260 }: { data: Record<string, unknown>[]; xKey: string; series: { key: string; label: string }[]; height?: number }) {
  return (
    <div>
      {series.length > 1 && (
        <ul className="mb-3 flex flex-wrap gap-4 text-xs text-ink-600" aria-label="Legend">
          {series.map((s, i) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded" style={{ background: SERIES[i] }} aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <RLineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--chart-grid)" }} minTickGap={16} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }} />
          {series.map((s, i) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={SERIES[i]} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />
          ))}
        </RLineChart>
      </ResponsiveContainer>
    </div>
  );
}
