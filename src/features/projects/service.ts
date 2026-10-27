import { Types, type FilterQuery } from "mongoose";
import { z } from "zod";
import { PROJECT_STATUSES, TASK_STATUSES } from "@/lib/constants";
import { Organization, Project, ProjectTask, User, type ProjectDoc, type ProjectTaskDoc } from "@/models";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { can, isClient, isInternal, type Actor } from "@/lib/permissions";
import { objectId, paginate, parseObjectId } from "@/lib/validation";
import { notifyUsers } from "@/features/notifications/service";

/** Lightweight projects — client: own org; projects.manage: all; staff with projects.assigned: projects they're assigned to. */
export function projectAccessFilter(actor: Actor): FilterQuery<ProjectDoc> {
  if (isClient(actor)) {
    if (!actor.organizationId) throw Errors.forbidden();
    return { organizationId: new Types.ObjectId(actor.organizationId) };
  }
  if (can(actor, "projects.manage")) return {};
  if (isInternal(actor)) return can(actor, "projects.assigned") ? { assignedStaff: new Types.ObjectId(actor.id) } : { _id: { $in: [] } };
  throw Errors.forbidden();
}

export async function listProjects(actor: Actor, opts: { status?: string; organizationId?: string; page?: number } = {}) {
  const page = opts.page ?? 1;
  const filter: FilterQuery<ProjectDoc> = { ...projectAccessFilter(actor) };
  if (opts.status && (PROJECT_STATUSES as readonly string[]).includes(opts.status)) filter.status = opts.status;
  if (opts.organizationId && isInternal(actor) && Types.ObjectId.isValid(opts.organizationId)) filter.organizationId = new Types.ObjectId(opts.organizationId);
  const [items, total] = await Promise.all([
    Project.find(filter).select("-activity").sort({ status: 1, dueDate: 1 }).skip((page - 1) * 25).limit(25).populate("organizationId", "name").populate("assignedStaff", "name").lean<ProjectDoc[]>(),
    Project.countDocuments(filter),
  ]);
  const taskStats = await ProjectTask.aggregate([
    { $match: { projectId: { $in: items.map((p) => p._id) }, ...(isClient(actor) && { visibleToClient: true }) } },
    { $group: { _id: "$projectId", total: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ["$status", "DONE"] }, 1, 0] } } } },
  ]);
  const map = new Map(taskStats.map((t) => [String(t._id), t]));
  return paginate(items.map((p) => ({ ...p, tasks: { total: map.get(String(p._id))?.total ?? 0, done: map.get(String(p._id))?.done ?? 0 } })), total, page, 25);
}

export async function getProject(actor: Actor, id: string) {
  const project = await Project.findOne({ _id: parseObjectId(id), ...projectAccessFilter(actor) })
    .populate("organizationId", "name")
    .populate("assignedStaff", "name email")
    .populate("activity.actorId", "name")
    .lean<ProjectDoc>();
  if (!project) throw Errors.notFound();
  const tasks = await ProjectTask.find({ projectId: project._id, ...(isClient(actor) && { visibleToClient: true }) })
    .sort({ status: 1, sortOrder: 1, dueDate: 1 })
    .populate("assigneeId", "name")
    .lean<ProjectTaskDoc[]>();
  return { project, tasks, canManage: isInternal(actor) };
}

export const projectSchema = z.object({
  organizationId: objectId,
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(5000).optional(),
  status: z.enum(PROJECT_STATUSES).default("PLANNED"),
  startDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  assignedStaff: z.array(objectId).max(10).default([]),
});

export async function saveProject(actor: Actor, id: string | null, input: unknown) {
  if (!can(actor, "projects.manage")) throw Errors.forbidden();
  const data = projectSchema.parse(input);
  if (!(await Organization.exists({ _id: data.organizationId }))) throw Errors.badRequest("Client not found");
  const staffCount = await User.countDocuments({ _id: { $in: data.assignedStaff }, role: { $in: ["OWNER", "ADMIN", "STAFF"] } });
  if (staffCount !== data.assignedStaff.length) throw Errors.badRequest("Assigned staff must be internal users.");
  let project;
  if (id) {
    project = await Project.findByIdAndUpdate(
      parseObjectId(id),
      { $set: data, $push: { activity: { actorId: actor.id, text: "Project updated", at: new Date() } } },
      { new: true },
    ).lean<ProjectDoc>();
    if (!project) throw Errors.notFound();
  } else {
    project = (await Project.create({ ...data, createdBy: actor.id, activity: [{ actorId: actor.id, text: "Project created", at: new Date() }] })).toObject();
    await notifyUsers(data.assignedStaff.filter((s) => s !== actor.id), { type: "SYSTEM", title: `Added to project: ${data.name}`, link: `/dashboard/projects/${project._id}` });
  }
  await audit(actor, id ? "project.updated" : "project.created", { entityType: "Project", entityId: String(project._id), organizationId: data.organizationId, metadata: { name: data.name, status: data.status } });
  return project;
}

export const taskSchema = z.object({
  title: z.string().trim().min(2).max(300),
  status: z.enum(TASK_STATUSES).default("TODO"),
  dueDate: z.coerce.date().optional().nullable(),
  assigneeId: objectId.optional().nullable(),
  visibleToClient: z.boolean().default(true),
});

async function loadManageableProject(actor: Actor, projectId: string) {
  if (!isInternal(actor)) throw Errors.forbidden();
  const project = await Project.findOne({ _id: parseObjectId(projectId), ...projectAccessFilter(actor) }).lean<ProjectDoc>();
  if (!project) throw Errors.notFound();
  return project;
}

export async function addTask(actor: Actor, projectId: string, input: unknown) {
  const project = await loadManageableProject(actor, projectId);
  const data = taskSchema.parse(input);
  await ProjectTask.create({ ...data, projectId: project._id, organizationId: project.organizationId });
  await Project.updateOne({ _id: project._id }, { $push: { activity: { actorId: actor.id, text: `Task added: ${data.title}`, at: new Date() } } });
}

export async function updateTask(actor: Actor, projectId: string, taskId: string, input: unknown) {
  const project = await loadManageableProject(actor, projectId);
  const data = taskSchema.partial().parse(input);
  const task = await ProjectTask.findOneAndUpdate({ _id: parseObjectId(taskId), projectId: project._id }, { $set: data }, { new: true }).lean<ProjectTaskDoc>();
  if (!task) throw Errors.notFound();
  if (data.status) await Project.updateOne({ _id: project._id }, { $push: { activity: { actorId: actor.id, text: `"${task.title}" → ${data.status.replace("_", " ").toLowerCase()}`, at: new Date() } } });
}

export async function deleteTask(actor: Actor, projectId: string, taskId: string) {
  const project = await loadManageableProject(actor, projectId);
  await ProjectTask.deleteOne({ _id: parseObjectId(taskId), projectId: project._id });
}
