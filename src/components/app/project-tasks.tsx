"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { EyeOff, Trash2 } from "lucide-react";
import { TASK_STATUSES } from "@/lib/constants";
import { apiFetch, ApiError } from "@/lib/api/client";
import { formatDate, humanize } from "@/lib/utils/format";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export type TaskView = { id: string; title: string; status: string; dueDate?: string; assignee?: string; visibleToClient: boolean };

export function ProjectTasks({ projectId, tasks, staff, canManage }: { projectId: string; tasks: TaskView[]; staff: { id: string; name: string }[]; canManage: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  async function call(fn: () => Promise<unknown>, msg?: string) {
    setPending(true);
    try {
      await fn();
      if (msg) toast.success(msg);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }
  function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    void call(() => apiFetch(`/api/projects/${projectId}`, { body: { title: fd.get("title"), dueDate: fd.get("dueDate") || undefined, assigneeId: fd.get("assigneeId") || undefined, visibleToClient: fd.get("visibleToClient") === "on" } }), "Task added").then(() => form.reset());
  }
  return (
    <div>
      <ul className="divide-y divide-ink-100">
        {tasks.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            {canManage ? (
              <input
                type="checkbox"
                checked={t.status === "DONE"}
                onChange={(e) => void call(() => apiFetch(`/api/projects/${projectId}/tasks/${t.id}`, { method: "PATCH", body: { status: e.target.checked ? "DONE" : "TODO" } }))}
                className="h-4 w-4 accent-brand-600"
                aria-label={`Mark "${t.title}" ${t.status === "DONE" ? "not done" : "done"}`}
              />
            ) : (
              <span className={cn("h-2.5 w-2.5 rounded-full", t.status === "DONE" ? "bg-emerald-500" : t.status === "IN_PROGRESS" ? "bg-brand-500" : "bg-ink-300")} aria-hidden />
            )}
            <span className={cn("min-w-0 flex-1", t.status === "DONE" && "text-ink-400 line-through")}>{t.title}</span>
            {!t.visibleToClient && (
              <span className="inline-flex items-center gap-1 text-xs text-ink-400" title="Internal — hidden from the client">
                <EyeOff className="h-3.5 w-3.5" aria-hidden /> internal
              </span>
            )}
            <span className="text-xs text-ink-500">
              {t.assignee ?? ""} {t.dueDate && `· due ${formatDate(t.dueDate)}`}
            </span>
            {canManage ? (
              <>
                <Select value={t.status} onChange={(e) => void call(() => apiFetch(`/api/projects/${projectId}/tasks/${t.id}`, { method: "PATCH", body: { status: e.target.value } }))} aria-label="Task status" className="w-32 text-xs">
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {humanize(s)}
                    </option>
                  ))}
                </Select>
                <button type="button" onClick={() => void call(() => apiFetch(`/api/projects/${projectId}/tasks/${t.id}`, { method: "DELETE" }), "Task removed")} className="rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-600" aria-label={`Delete ${t.title}`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            ) : (
              <span className="text-xs text-ink-500">{humanize(t.status)}</span>
            )}
          </li>
        ))}
        {tasks.length === 0 && <li className="px-5 py-4 text-sm text-ink-500">No tasks yet.</li>}
      </ul>
      {canManage && (
        <form onSubmit={add} className="flex flex-col gap-2 border-t border-ink-100 p-4 lg:flex-row lg:items-center">
          <Input name="title" placeholder="New task" required aria-label="Task title" className="lg:flex-1" />
          <Input name="dueDate" type="date" aria-label="Due date" className="lg:w-40" />
          <Select name="assigneeId" aria-label="Assignee" className="lg:w-40" defaultValue="">
            <option value="">Unassigned</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Checkbox name="visibleToClient" defaultChecked label="Client can see" />
          <Button type="submit" size="sm" loading={pending}>
            Add task
          </Button>
        </form>
      )}
    </div>
  );
}
