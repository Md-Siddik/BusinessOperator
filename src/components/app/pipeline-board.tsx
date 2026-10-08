"use client";

import Link from "next/link";
import { useState } from "react";
import { GripVertical } from "lucide-react";
import { LEAD_STAGES, LEAD_STAGE_LABELS } from "@/lib/constants";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useToast } from "@/components/ui/toast";
import { ScorePill } from "@/components/ui/data";
import { cn } from "@/lib/utils";

export type PipelineCard = { id: string; name: string; countryCode: string; city?: string; score: number; stage: string; isDemo?: boolean };
export type PipelineColumn = { stage: string; label: string; count: number; items: PipelineCard[] };

/**
 * Kanban pipeline. Drag a card between columns, or use the per-card stage
 * menu (keyboard and screen-reader friendly). Updates are optimistic and
 * rolled back if the server rejects the change.
 */
export function PipelineBoard({ initial, threshold }: { initial: PipelineColumn[]; threshold: number }) {
  const [columns, setColumns] = useState(initial);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const toast = useToast();

  async function move(cardId: string, toStage: string) {
    const from = columns.find((c) => c.items.some((i) => i.id === cardId));
    if (!from || from.stage === toStage) return;
    const card = from.items.find((i) => i.id === cardId)!;
    const snapshot = columns;
    setColumns((cols) =>
      cols.map((c) =>
        c.stage === from.stage
          ? { ...c, count: c.count - 1, items: c.items.filter((i) => i.id !== cardId) }
          : c.stage === toStage
            ? { ...c, count: c.count + 1, items: [{ ...card, stage: toStage }, ...c.items] }
            : c,
      ),
    );
    try {
      await apiFetch(`/api/crm/${cardId}/stage`, { body: { stage: toStage } });
      toast.success(`${card.name} → ${LEAD_STAGE_LABELS[toStage as keyof typeof LEAD_STAGE_LABELS]}`);
    } catch (e) {
      setColumns(snapshot);
      toast.error(e instanceof ApiError ? e.message : "Could not move the lead");
    }
  }

  return (
    <div className="scroll-thin -mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
      <div className="flex min-w-max gap-3">
        {columns.map((col) => (
          <section
            key={col.stage}
            aria-label={`${col.label} (${col.count})`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(col.stage);
            }}
            onDragLeave={() => setOver((o) => (o === col.stage ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData("text/plain");
              if (id) void move(id, col.stage);
            }}
            className={cn("flex w-72 flex-col rounded-2xl border bg-ink-50/80 transition-colors", over === col.stage ? "border-brand-300 bg-brand-50/60" : "border-ink-200")}
          >
            <header className="flex items-center justify-between px-3.5 py-3">
              <h2 className="text-sm font-semibold text-ink-800">{col.label}</h2>
              <span className="rounded-full bg-white px-2 text-xs font-medium tabular-nums text-ink-600 ring-1 ring-ink-200">{col.count}</span>
            </header>
            <ul className="scroll-thin flex max-h-[65vh] flex-1 flex-col gap-2 overflow-y-auto px-2.5 pb-2.5">
              {col.items.map((card) => (
                <li
                  key={card.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", card.id);
                    setDragging(card.id);
                  }}
                  onDragEnd={() => setDragging(null)}
                  className={cn("group rounded-xl border border-ink-200 bg-white p-3 shadow-soft", dragging === card.id && "opacity-50")}
                >
                  <div className="flex items-start gap-2">
                    <GripVertical className="mt-0.5 h-4 w-4 shrink-0 cursor-grab text-ink-300" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <Link href={`/dashboard/companies/${card.countryCode.toLowerCase()}/${card.id}`} className="line-clamp-2 text-sm font-medium text-ink-900 hover:text-brand-700">
                        {card.name}
                      </Link>
                      <p className="mt-0.5 text-xs text-ink-500">
                        {card.countryCode} {card.city && `· ${card.city}`} {card.isDemo && <span className="text-amber-700">· demo</span>}
                      </p>
                    </div>
                    <ScorePill score={card.score} threshold={threshold} />
                  </div>
                  <label className="mt-2 block">
                    <span className="sr-only">Move {card.name} to stage</span>
                    <select value={card.stage} onChange={(e) => void move(card.id, e.target.value)} className="w-full rounded-md border border-transparent bg-ink-50 px-2 py-1 text-xs text-ink-600 hover:border-ink-200 focus:border-brand-400 focus:outline-none">
                      {LEAD_STAGES.map((s) => (
                        <option key={s} value={s}>
                          {LEAD_STAGE_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                </li>
              ))}
              {col.items.length === 0 && <li className="rounded-xl border border-dashed border-ink-200 px-3 py-6 text-center text-xs text-ink-400">Drop leads here</li>}
              {col.count > col.items.length && <li className="px-1 text-center text-xs text-ink-500">+{col.count - col.items.length} more (highest scores shown)</li>}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
