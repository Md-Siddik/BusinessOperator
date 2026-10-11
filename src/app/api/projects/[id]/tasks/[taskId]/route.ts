import { readJson, route } from "@/lib/api/handler";
import { deleteTask, updateTask } from "@/features/projects/service";

type P = { id: string; taskId: string };
export const PATCH = route<P>({ internal: true, staff: true }, async ({ req, actor, params }) => {
  await updateTask(actor, params.id, params.taskId, await readJson(req));
  return { ok: true };
});
export const DELETE = route<P>({ internal: true, staff: true }, async ({ actor, params }) => {
  await deleteTask(actor, params.id, params.taskId);
  return { ok: true };
});
