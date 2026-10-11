import { readJson, route } from "@/lib/api/handler";
import { addTask, getProject, saveProject } from "@/features/projects/service";

type P = { id: string };
export const GET = route<P>({}, async ({ actor, params }) => getProject(actor, params.id));
export const PATCH = route<P>({ internal: true, staff: true }, async ({ req, actor, params }) => saveProject(actor, params.id, await readJson(req)));
/** Add a task to the project. */
export const POST = route<P>({ internal: true, staff: true }, async ({ req, actor, params }) => {
  await addTask(actor, params.id, await readJson(req));
  return { ok: true };
});
